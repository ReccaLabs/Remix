import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, gt, isNull, lt, sql } from 'drizzle-orm';
import { schema, withTenant, type Db, type Tx } from '@remix/db';
import {
  OTP_RULES,
  tenantAccess,
  type OtpPurpose,
  type OtpRequest,
  type UserKind,
} from '@remix/types/api';
import { AppException } from '../../common/errors/app-exception';
import { tenantUnavailable } from '../../common/tenant/tenant-access.guard';
import type { ResolvedTenant } from '../../common/tenant/tenant-resolver';
import { CLOCK, type Clock } from '../../common/time/clock';
import { APP_CONFIG, type AppConfig } from '../../config/config';
import { AuditService } from '../audit/audit.service';
import { DB } from '../db/db.module';
import { AuthSmsService } from './auth-sms.service';
import { CodeSendLimits } from './code-send-limits';
import { digestsEqual, hashCode, newOtpCode } from './codes';
import { isCommonPassword } from './common-passwords';
import { clearDeviceTrust, revokeUserSessions } from './device-store';
import { codeInvalid } from './login.service';
import { PasswordService } from './passwords';
import { createTicket, findOpenTicket, spendTicket } from './tickets';

const { otpChallenges, tenantUsers, students, tenants } = schema;

interface CodeUser {
  id: string;
  kind: UserKind;
  status: 'active' | 'disabled' | 'invited';
  archivedAt: Date | null;
  lockedAt: Date | null;
}

/** 400 VALIDATION_FAILED on `newPassword` for a password on the common list (AUTH-09). */
export function commonPasswordRejected(): AppException {
  return new AppException('VALIDATION_FAILED', 400, 'Choose a less common password', {
    errors: [{ path: 'newPassword', message: 'This password is too common' }],
  });
}

/**
 * Who may receive a code of `purpose` (anyone else gets the same 202 and no SMS):
 * - password purposes: any account that is not disabled (an archived student cannot);
 *   `first_password` and `password_reset` both work for `invited` and `active` accounts, so a
 *   student who picks the "wrong" link still gets in;
 * - `unlock`: only a locked account.
 */
function eligible(user: CodeUser | null, purpose: OtpPurpose): user is CodeUser {
  if (!user || user.status === 'disabled') return false;
  if (user.kind === 'student' && user.archivedAt !== null) return false;
  return purpose === 'unlock' ? user.lockedAt !== null : true;
}

/**
 * SMS one-time codes for password reset, first password and unlock (AUTH-02/07/09; ADR 0004
 * addendum) and the password tickets they lead to.
 */
@Injectable()
export class OtpService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly passwords: PasswordService,
    private readonly audit: AuditService,
    private readonly limits: CodeSendLimits,
    private readonly sms: AuthSmsService,
  ) {}

  /**
   * Same work and the same answer for every phone: the per-phone limits are counted first (for
   * every phone), then a challenge row is written — with `user_id` null when nobody may receive
   * the code — and an SMS is queued only for an eligible account. A send suppressed by a limit
   * also answers 202. The only failure is a 503 when Valkey or the queue is down, for any phone.
   */
  async request(tenant: ResolvedTenant, input: Required<OtpRequest>): Promise<void> {
    if (tenantAccess(tenant.status).staff === 'none') throw tenantUnavailable();
    const decision = await this.limits.consumeSend(tenant.id, input.phone);
    if (!decision.allowed) return;
    await this.issueCode(tenant.id, input.phone, input.purpose, null);
  }

  /**
   * Store a fresh code for (phone, purpose), invalidating older ones, and queue the SMS when the
   * phone's account may receive it. `forUserId` restricts delivery to that account (staff-
   * triggered sends). Returns whether an SMS was queued.
   */
  private async issueCode(
    tenantId: string,
    phone: string,
    purpose: OtpPurpose,
    forUserId: string | null,
  ): Promise<boolean> {
    const now = this.clock.now();
    const code = newOtpCode();
    const codeHash = hashCode(this.config.authCodeSecret, [tenantId, phone, purpose], code);
    return withTenant(this.db, tenantId, async (tx) => {
      const user = await this.userByPhone(tx, tenantId, phone);
      const recipient =
        eligible(user, purpose) && (forUserId === null || user.id === forUserId) ? user : null;

      await tx
        .update(otpChallenges)
        .set({ consumedAt: now })
        .where(
          and(
            eq(otpChallenges.tenantId, tenantId),
            eq(otpChallenges.phone, phone),
            eq(otpChallenges.purpose, purpose),
            isNull(otpChallenges.consumedAt),
          ),
        );
      const [row] = await tx
        .insert(otpChallenges)
        .values({
          tenantId,
          phone,
          userId: recipient?.id ?? null,
          purpose,
          codeHash,
          expiresAt: new Date(now.getTime() + OTP_RULES.ttlSeconds * 1000),
          createdAt: now,
          updatedAt: now,
        })
        .returning({ id: otpChallenges.id });
      if (!row) throw new Error('Challenge insert returned nothing');
      if (!recipient) return false;

      await this.sms.send(tenantId, row.id, phone, {
        kind: 'code',
        purpose,
        code,
        tenantName: await this.tenantName(tx, tenantId),
      });
      return true;
    });
  }

  /**
   * Check a code. Wrong, expired, burnt, superseded and never-sent codes are all the same
   * 400 `CODE_INVALID`; every wrong guess counts and the 5th burns the code. A right code is
   * spent by one conditional UPDATE (never twice). `unlock` clears the lockout right away;
   * the password purposes return a 10-minute single-use ticket for {@link setPassword}.
   */
  async verify(
    tenant: ResolvedTenant,
    input: { phone: string; purpose: OtpPurpose; code: string },
  ): Promise<{ ticket: string | null }> {
    if (tenantAccess(tenant.status).staff === 'none') throw tenantUnavailable();
    const now = this.clock.now();
    const actual = hashCode(
      this.config.authCodeSecret,
      [tenant.id, input.phone, input.purpose],
      input.code,
    );
    const outcome = await withTenant(this.db, tenant.id, async (tx) => {
      const [challenge] = await tx
        .select({
          id: otpChallenges.id,
          userId: otpChallenges.userId,
          codeHash: otpChallenges.codeHash,
        })
        .from(otpChallenges)
        .where(
          and(
            eq(otpChallenges.tenantId, tenant.id),
            eq(otpChallenges.phone, input.phone),
            eq(otpChallenges.purpose, input.purpose),
            isNull(otpChallenges.consumedAt),
            gt(otpChallenges.expiresAt, now),
            lt(otpChallenges.attempts, OTP_RULES.maxAttempts),
          ),
        )
        .orderBy(desc(otpChallenges.createdAt), desc(otpChallenges.id))
        .limit(1)
        .for('update');
      if (!challenge) return null;

      // Compared even for a never-sent code, which can then never match a delivery.
      const matches = digestsEqual(actual, challenge.codeHash) && challenge.userId !== null;
      if (!matches) {
        await tx
          .update(otpChallenges)
          .set({
            attempts: sql`${otpChallenges.attempts} + 1`,
            consumedAt: sql`case when ${otpChallenges.attempts} + 1 >= ${OTP_RULES.maxAttempts} then ${now}::timestamptz else null end`,
          })
          .where(and(eq(otpChallenges.tenantId, tenant.id), eq(otpChallenges.id, challenge.id)));
        return null;
      }
      const spent = await tx
        .update(otpChallenges)
        .set({ consumedAt: now })
        .where(
          and(
            eq(otpChallenges.tenantId, tenant.id),
            eq(otpChallenges.id, challenge.id),
            isNull(otpChallenges.consumedAt),
          ),
        )
        .returning({ id: otpChallenges.id });
      const userId = challenge.userId;
      if (spent.length !== 1 || !userId) return null;

      const user = await this.userById(tx, tenant.id, userId);
      if (!eligible(user, input.purpose)) return null;

      if (input.purpose === 'unlock') {
        await tx
          .update(tenantUsers)
          .set({ lockedAt: null, failedLoginCount: 0 })
          .where(and(eq(tenantUsers.tenantId, tenant.id), eq(tenantUsers.id, user.id)));
        await this.audit.record(tx, tenant.id, {
          action: 'auth.unlock',
          actorId: user.id,
          actorKind: user.kind,
          entity: 'tenant_user',
          entityId: user.id,
          after: { via: 'sms_code' },
          at: now,
        });
        return { ticket: null };
      }
      const ticket = await createTicket(tx, tenant.id, {
        userId: user.id,
        kind: 'password',
        purpose: input.purpose,
        now,
      });
      return { ticket: ticket.token };
    });
    if (!outcome) throw codeInvalid();
    return outcome;
  }

  /**
   * Spend a password ticket and set the password: an `invited` account becomes `active`, any
   * lockout and temporary-password flag is cleared, every session of the user is revoked and
   * every trusted computer forgotten. Does not sign in. The ticket is checked before hashing
   * (no Argon2 work for junk) and spent atomically in the same transaction as the change.
   */
  async setPassword(
    tenant: ResolvedTenant,
    input: { ticket: string; newPassword: string },
  ): Promise<void> {
    if (tenantAccess(tenant.status).staff === 'none') throw tenantUnavailable();
    if (isCommonPassword(input.newPassword)) throw commonPasswordRejected();
    const peek = await withTenant(this.db, tenant.id, (tx) =>
      findOpenTicket(tx, tenant.id, 'password', input.ticket, this.clock.now()),
    );
    if (!peek) throw codeInvalid();
    const passwordHash = await this.passwords.hash(input.newPassword);

    const now = this.clock.now();
    await withTenant(this.db, tenant.id, async (tx) => {
      const ticket = await findOpenTicket(tx, tenant.id, 'password', input.ticket, now, {
        forUpdate: true,
      });
      if (!ticket || !(await spendTicket(tx, tenant.id, ticket.id, now))) throw codeInvalid();
      const user = await this.userById(tx, tenant.id, ticket.userId);
      if (!user || !eligible(user, ticket.purpose ?? 'password_reset')) throw codeInvalid();

      await tx
        .update(tenantUsers)
        .set({
          passwordHash,
          status: 'active',
          mustChangePassword: false,
          lockedAt: null,
          failedLoginCount: 0,
        })
        .where(and(eq(tenantUsers.tenantId, tenant.id), eq(tenantUsers.id, user.id)));
      const revoked = await revokeUserSessions(tx, tenant.id, {
        userId: user.id,
        reason: 'password_reset',
        now,
      });
      await clearDeviceTrust(tx, tenant.id, user.id);
      await this.audit.record(tx, tenant.id, {
        action: 'auth.password.set',
        actorId: user.id,
        actorKind: user.kind,
        entity: 'tenant_user',
        entityId: user.id,
        after: {
          via: ticket.purpose,
          activated: user.status === 'invited',
          sessionsRevoked: revoked,
        },
        at: now,
      });
    });
  }

  /**
   * Staff-triggered code to one account (AUTH-08 reset → `password_reset`; P2-B's "student
   * added" hook → `first_password`). Uses the same per-phone limits as the public request; a
   * limited send is a 429 here, because the caller is staff, not an anonymous visitor. Returns
   * whether an SMS was queued (false when the account cannot receive one).
   */
  async sendCodeToUser(tenantId: string, userId: string, purpose: OtpPurpose): Promise<boolean> {
    const phone = await withTenant(this.db, tenantId, async (tx) => {
      const [row] = await tx
        .select({ phone: tenantUsers.phone })
        .from(tenantUsers)
        .where(and(eq(tenantUsers.tenantId, tenantId), eq(tenantUsers.id, userId)));
      return row?.phone ?? null;
    });
    if (!phone || !/^\+947\d{8}$/.test(phone)) return false;
    const decision = await this.limits.consumeSend(tenantId, phone);
    if (!decision.allowed) {
      throw new AppException('RATE_LIMITED', 429, 'A code was sent recently. Try again later.', {
        headers: { 'retry-after': String(decision.retryAfterSec) },
      });
    }
    return this.issueCode(tenantId, phone, purpose, userId);
  }

  private userColumns() {
    return {
      id: tenantUsers.id,
      kind: tenantUsers.kind,
      status: tenantUsers.status,
      archivedAt: students.archivedAt,
      lockedAt: tenantUsers.lockedAt,
    };
  }

  private async userByPhone(tx: Tx, tenantId: string, phone: string): Promise<CodeUser | null> {
    const [row] = await tx
      .select(this.userColumns())
      .from(tenantUsers)
      .leftJoin(
        students,
        and(eq(students.tenantId, tenantUsers.tenantId), eq(students.userId, tenantUsers.id)),
      )
      .where(and(eq(tenantUsers.tenantId, tenantId), eq(tenantUsers.phone, phone)))
      .limit(1);
    return row ?? null;
  }

  private async userById(tx: Tx, tenantId: string, userId: string): Promise<CodeUser | null> {
    const [row] = await tx
      .select(this.userColumns())
      .from(tenantUsers)
      .leftJoin(
        students,
        and(eq(students.tenantId, tenantUsers.tenantId), eq(students.userId, tenantUsers.id)),
      )
      .where(and(eq(tenantUsers.tenantId, tenantId), eq(tenantUsers.id, userId)))
      .limit(1);
    return row ?? null;
  }

  private async tenantName(tx: Tx, tenantId: string): Promise<string> {
    const [row] = await tx
      .select({ name: tenants.name })
      .from(tenants)
      .where(eq(tenants.id, tenantId));
    return row?.name ?? 'ReMix';
  }
}
