import { randomBytes } from 'node:crypto';
import type { IncomingHttpHeaders } from 'node:http';
import { Inject, Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { schema, withTenant, type Db, type Tx } from '@remix/db';
import { STUDENT_DEVICE_LIMIT, type AppLocale, type DevicesResponse } from '@remix/types/api';
import { AppException } from '../../common/errors/app-exception';
import { CLOCK, type Clock } from '../../common/time/clock';
import { AuditService } from '../audit/audit.service';
import { DB } from '../db/db.module';
import { isCommonPassword } from './common-passwords';
import { activeDevices, clearDeviceTrust, revokeUserSessions, signOutDevice } from './device-store';
import { OtpService, commonPasswordRejected } from './otp.service';
import { PasswordService } from './passwords';
import { SessionIssuer, type LoginResult } from './session-issuer';
import type { SessionRecord } from './session.service';

const { tenantUsers, students } = schema;

const notFound = () => new AppException('NOT_FOUND', 404);

/**
 * The signed-in user's own account (AUTH-04) and staff actions on a student's sign-in
 * (AUTH-08). Every query runs in the session's tenant (`withTenant`), and every target row is
 * matched on its owner too, so an id from another user or institute is simply "not found".
 */
@Injectable()
export class AccountService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly passwords: PasswordService,
    private readonly audit: AuditService,
    private readonly issuer: SessionIssuer,
    private readonly otp: OtpService,
  ) {}

  async updateLocale(session: SessionRecord, locale: AppLocale): Promise<void> {
    await withTenant(this.db, session.tenantId, (tx) =>
      tx
        .update(tenantUsers)
        .set({ locale })
        .where(and(eq(tenantUsers.tenantId, session.tenantId), eq(tenantUsers.id, session.userId))),
    );
  }

  async devices(session: SessionRecord): Promise<DevicesResponse> {
    const now = this.clock.now();
    const rows = await withTenant(this.db, session.tenantId, (tx) =>
      activeDevices(tx, session.tenantId, session.userId, now),
    );
    return {
      items: rows.map((d) => ({
        id: d.id,
        label: d.label,
        firstSeenAt: d.firstSeenAt.toISOString(),
        lastSeenAt: d.lastSeenAt.toISOString(),
        current: d.id === session.deviceId,
      })),
      limit: session.kind === 'student' ? STUDENT_DEVICE_LIMIT : null,
    };
  }

  /** Sign out one of the user's own devices. Returns true when it was the current one. */
  async signOutOwnDevice(session: SessionRecord, deviceId: string): Promise<boolean> {
    const now = this.clock.now();
    await withTenant(this.db, session.tenantId, async (tx) => {
      const done = await signOutDevice(tx, session.tenantId, {
        userId: session.userId,
        deviceId,
        by: session.userId,
        reason: 'device_signed_out',
        now,
      });
      if (!done) throw notFound();
      await this.audit.record(tx, session.tenantId, {
        action: 'auth.device.signed_out',
        actorId: session.userId,
        actorKind: session.kind,
        entity: 'device',
        entityId: deviceId,
        after: { reason: 'self', userId: session.userId },
        at: now,
      });
    });
    return deviceId === session.deviceId;
  }

  /**
   * Change the password while signed in: the current password must be right (400
   * `INVALID_CREDENTIALS` otherwise), the new one not common. Every session of the user —
   * including this one — is revoked and this device gets a fresh session with the same absolute
   * expiry (ADR 0004: no token survives a password change); trusted computers are forgotten.
   */
  async changePassword(
    session: SessionRecord,
    input: { currentPassword: string; newPassword: string; headers: IncomingHttpHeaders },
  ): Promise<LoginResult> {
    if (session.impersonatedBy) throw new AppException('FORBIDDEN', 403);
    if (isCommonPassword(input.newPassword)) throw commonPasswordRejected();
    const current = await withTenant(this.db, session.tenantId, async (tx) => {
      const [row] = await tx
        .select({
          passwordHash: tenantUsers.passwordHash,
          mustChange: tenantUsers.mustChangePassword,
        })
        .from(tenantUsers)
        .where(and(eq(tenantUsers.tenantId, session.tenantId), eq(tenantUsers.id, session.userId)));
      return row ?? null;
    });
    const ok = current?.passwordHash
      ? await this.passwords.verify(current.passwordHash, input.currentPassword)
      : await this.passwords.verifyDummy(input.currentPassword);
    if (!ok) {
      throw new AppException('INVALID_CREDENTIALS', 400, 'The current password is wrong', {
        errors: [{ path: 'currentPassword', message: 'The current password is wrong' }],
      });
    }
    const passwordHash = await this.passwords.hash(input.newPassword);

    const now = this.clock.now();
    return withTenant(this.db, session.tenantId, async (tx) => {
      await tx
        .update(tenantUsers)
        .set({ passwordHash, mustChangePassword: false })
        .where(and(eq(tenantUsers.tenantId, session.tenantId), eq(tenantUsers.id, session.userId)));
      const revoked = await revokeUserSessions(tx, session.tenantId, {
        userId: session.userId,
        reason: 'password_change',
        now,
      });
      await clearDeviceTrust(tx, session.tenantId, session.userId);
      await this.audit.record(tx, session.tenantId, {
        action: 'auth.password.changed',
        actorId: session.userId,
        actorKind: session.kind,
        entity: 'tenant_user',
        entityId: session.userId,
        after: { sessionsRevoked: revoked, wasTemporary: current?.mustChange ?? false },
        at: now,
      });
      const issued = await this.issuer.issue(
        tx,
        session.tenantId,
        {
          id: session.userId,
          kind: session.kind,
          roles: session.roles,
          displayName: session.displayName,
          locale: session.locale,
          mustChangePassword: false,
        },
        {
          staySignedIn: session.staySignedIn,
          headers: input.headers,
          now,
          expiresAt: session.expiresAt,
          method: 'password_change',
          enforceDeviceLimit: false,
        },
      );
      if (issued.status !== 'issued') throw new Error('Device limit is not enforced here');
      return issued.result;
    });
  }

  // ----- AUTH-08: staff on a student's sign-in ------------------------------------------------

  async signOutStudentDevice(
    staff: SessionRecord,
    studentId: string,
    deviceId: string,
  ): Promise<void> {
    const now = this.clock.now();
    await withTenant(this.db, staff.tenantId, async (tx) => {
      if (!(await this.isStudent(tx, staff.tenantId, studentId))) throw notFound();
      const done = await signOutDevice(tx, staff.tenantId, {
        userId: studentId,
        deviceId,
        by: staff.userId,
        reason: 'device_signed_out',
        now,
      });
      if (!done) throw notFound();
      await this.audit.record(tx, staff.tenantId, {
        action: 'auth.device.signed_out',
        actorId: staff.userId,
        actorKind: 'staff',
        entity: 'device',
        entityId: deviceId,
        after: { reason: 'staff', userId: studentId },
        at: now,
      });
    });
  }

  /**
   * AUTH-08 reset: the old password stops working at once (replaced by an unusable random
   * hash), every session and trusted computer of the student ends, and a `password_reset` code
   * is texted so the student can choose a new password. 429 when a code went to that phone
   * moments ago (per-phone SMS limits).
   */
  async resetStudentPassword(staff: SessionRecord, studentId: string): Promise<void> {
    const now = this.clock.now();
    const unusable = await this.passwords.hash(randomBytes(32).toString('base64url'));
    await withTenant(this.db, staff.tenantId, async (tx) => {
      const [student] = await tx
        .select({ status: tenantUsers.status, phone: tenantUsers.phone })
        .from(tenantUsers)
        .innerJoin(
          students,
          and(eq(students.tenantId, tenantUsers.tenantId), eq(students.userId, tenantUsers.id)),
        )
        .where(and(eq(tenantUsers.tenantId, staff.tenantId), eq(tenantUsers.id, studentId)));
      if (!student) throw notFound();
      if (student.status === 'disabled') {
        throw new AppException('CONFLICT', 409, 'This student is disabled', {
          detail: 'Turn the account back on before resetting the password.',
        });
      }
      if (student.status === 'active') {
        await tx
          .update(tenantUsers)
          .set({ passwordHash: unusable, mustChangePassword: false })
          .where(and(eq(tenantUsers.tenantId, staff.tenantId), eq(tenantUsers.id, studentId)));
      }
      const revoked = await revokeUserSessions(tx, staff.tenantId, {
        userId: studentId,
        reason: 'admin_password_reset',
        now,
      });
      await clearDeviceTrust(tx, staff.tenantId, studentId);
      await this.audit.record(tx, staff.tenantId, {
        action: 'auth.password.reset_by_staff',
        actorId: staff.userId,
        actorKind: 'staff',
        entity: 'tenant_user',
        entityId: studentId,
        after: { sessionsRevoked: revoked },
        at: now,
      });
    });
    await this.otp.sendCodeToUser(staff.tenantId, studentId, 'password_reset');
  }

  private async isStudent(tx: Tx, tenantId: string, userId: string): Promise<boolean> {
    const [row] = await tx
      .select({ id: students.userId })
      .from(students)
      .where(and(eq(students.tenantId, tenantId), eq(students.userId, userId)));
    return row !== undefined;
  }
}
