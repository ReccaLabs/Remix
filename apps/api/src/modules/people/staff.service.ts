import { createHash, randomBytes } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, gt, inArray, isNull, max, ne, sql } from 'drizzle-orm';
import { schema, withTenant, type Db, type Tx } from '@remix/db';
import { PLAN_LIMITS, type PlanLimits } from '@remix/types';
import {
  INVITE_TTL_HOURS,
  STAFF_ROLES,
  type API,
  type StaffMember,
  type StaffResponse,
  type StaffRole,
} from '@remix/types/api';
import { AppException } from '../../common/errors/app-exception';
import type { AuthSession } from '../../common/auth/session-authenticator';
import { CLOCK, type Clock } from '../../common/time/clock';
import type { EndpointBody } from '../../common/validation/endpoint';
import { AuditService, maskIdentifier, type AuditEntry } from '../audit/audit.service';
import { DB } from '../db/db.module';
import { PeopleHooks } from './people-hooks';
import { isUniqueViolation } from './scope';

const { tenantUsers, staffRoles, staffInvites, classes, sessions, tenants } = schema;

type InviteBody = EndpointBody<typeof API.inviteStaff>;
type UpdateBody = EndpointBody<typeof API.updateStaff>;
type Seat = 'teachers' | 'cashiers';
type Usage = Record<Seat, number>;

const SEAT_ROLE: Record<Seat, StaffRole> = { teachers: 'teacher', cashiers: 'cashier' };
const SEAT_OF: Partial<Record<StaffRole, Seat>> = { teacher: 'teachers', cashier: 'cashiers' };
const STAFF_DISABLED = 'staff_disabled';

const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');
const roleOrder = (role: StaffRole) => STAFF_ROLES.indexOf(role);
const conflict = (title: string) => new AppException('CONFLICT', 409, title);
const notFound = () => new AppException('NOT_FOUND', 404, 'Staff member not found');

function validation(path: string, message: string): AppException {
  return new AppException('VALIDATION_FAILED', 400, 'Check the highlighted fields', {
    errors: [{ path, message }],
  });
}

const actor = (
  session: AuthSession,
  at: Date,
): Pick<AuditEntry, 'actorId' | 'actorKind' | 'at'> => ({
  actorId: session.userId,
  actorKind: 'staff',
  at,
});

/**
 * STF-01/02/03 — staff list, invitations, role/scope changes. Plan seats (`PLAN_LIMITS`) count
 * active members plus pending invitations. The last active owner can never be demoted or
 * disabled. Role, scope, enable/disable and invitation changes are audited in the same
 * transaction.
 */
@Injectable()
export class StaffService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly audit: AuditService,
    private readonly hooks: PeopleHooks,
  ) {}

  // ----- STF-01 / STF-03 list ----------------------------------------------------------------

  list(tenantId: string): Promise<StaffResponse> {
    const now = this.clock.now();
    return withTenant(this.db, tenantId, async (tx) => {
      const users = await tx
        .select({
          id: tenantUsers.id,
          displayName: tenantUsers.displayName,
          phone: tenantUsers.phone,
          email: tenantUsers.email,
          status: tenantUsers.status,
        })
        .from(tenantUsers)
        .where(eq(tenantUsers.kind, 'staff'))
        .orderBy(asc(tenantUsers.displayName), asc(tenantUsers.id));
      const ids = users.map((u) => u.id);
      // Sequential: one transaction is one connection, which runs one query at a time.
      const roleRows = ids.length
        ? await tx.select().from(staffRoles).where(inArray(staffRoles.userId, ids))
        : [];
      const signIns = ids.length
        ? await tx
            .select({ userId: sessions.userId, last: max(sessions.createdAt) })
            .from(sessions)
            .where(inArray(sessions.userId, ids))
            .groupBy(sessions.userId)
        : [];
      const invites = await tx
        .select()
        .from(staffInvites)
        .where(pendingInvite(now))
        .orderBy(asc(staffInvites.createdAt), asc(staffInvites.id));
      const usage = await this.seatUsage(tx, now);
      const limits = await this.seatLimits(tx, tenantId);

      const lastSignIn = new Map(signIns.map((s) => [s.userId, s.last]));
      const members: StaffMember[] = users.map((u) => {
        const rows = roleRows.filter((r) => r.userId === u.id);
        return {
          id: u.id,
          displayName: u.displayName,
          phone: u.phone,
          email: u.email,
          roles: rows.map((r) => r.role).sort((a, b) => roleOrder(a) - roleOrder(b)),
          classScope: [
            ...new Set(rows.flatMap((r) => (r.role === 'teacher' ? (r.classScope ?? []) : []))),
          ],
          status: u.status,
          inviteExpiresAt: null,
          lastSignInAt: lastSignIn.get(u.id)?.toISOString() ?? null,
        };
      });
      const pending = invites.map((i) => inviteMember(i));
      return {
        items: [...members, ...pending],
        usage: {
          teachers: { used: usage.teachers, limit: limits.teachers },
          cashiers: { used: usage.cashiers, limit: limits.cashiers },
        },
      };
    });
  }

  // ----- STF-01 invite -----------------------------------------------------------------------

  async invite(tenantId: string, session: AuthSession, body: InviteBody): Promise<StaffMember> {
    const now = this.clock.now();
    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(now.getTime() + INVITE_TTL_HOURS * 3_600_000);

    const invite = await withTenant(this.db, tenantId, async (tx) => {
      await this.assertContactFree(tx, body.phone, body.email, now);
      const scope = body.role === 'teacher' ? [...new Set(body.classScope)] : [];
      await this.assertClasses(tx, scope);

      const seat = SEAT_OF[body.role];
      if (seat) await this.assertSeat(tx, tenantId, seat, now);

      let row: typeof staffInvites.$inferSelect | undefined;
      try {
        [row] = await tx
          .insert(staffInvites)
          .values({
            tenantId,
            displayName: body.displayName,
            phone: body.phone ?? null,
            email: body.email ?? null,
            role: body.role,
            classScope: scope,
            tokenHash: hashToken(token),
            invitedBy: session.userId,
            expiresAt,
          })
          .returning();
      } catch (error) {
        if (isUniqueViolation(error)) throw conflict('This person has already been invited');
        throw error;
      }
      if (!row) throw new Error('staff invite not created');
      await this.audit.record(tx, tenantId, {
        ...actor(session, now),
        action: 'staff.invite',
        entity: 'staff_invite',
        entityId: row.id,
        after: {
          role: body.role,
          classes: scope.length,
          contact: maskIdentifier(
            body.phone
              ? { kind: 'phone', phone: body.phone }
              : { kind: 'email', email: body.email ?? '' },
          ),
        },
      });
      return row;
    });

    // The hook delivers the invitation SMS (auth module) with the raw token.
    await this.hooks.onStaffInvited({
      tenantId,
      inviteId: invite.id,
      token,
      displayName: invite.displayName,
      phone: invite.phone,
      email: invite.email,
      role: invite.role,
      expiresAt,
    });
    return inviteMember(invite);
  }

  revokeInvite(tenantId: string, session: AuthSession, inviteId: string): Promise<void> {
    const now = this.clock.now();
    return withTenant(this.db, tenantId, async (tx) => {
      const [invite] = await tx.select().from(staffInvites).where(eq(staffInvites.id, inviteId));
      if (!invite) throw new AppException('NOT_FOUND', 404, 'Invitation not found');
      if (invite.acceptedAt) throw conflict('This invitation has already been accepted');
      if (invite.revokedAt) return;
      await tx.update(staffInvites).set({ revokedAt: now }).where(eq(staffInvites.id, inviteId));
      await this.audit.record(tx, tenantId, {
        ...actor(session, now),
        action: 'staff.invite_revoke',
        entity: 'staff_invite',
        entityId: inviteId,
        after: { role: invite.role },
      });
    });
  }

  // ----- STF-02 / STF-01 update --------------------------------------------------------------

  update(
    tenantId: string,
    session: AuthSession,
    userId: string,
    body: UpdateBody,
  ): Promise<StaffMember> {
    const now = this.clock.now();
    return withTenant(this.db, tenantId, async (tx) => {
      const [user] = await tx
        .select()
        .from(tenantUsers)
        .where(and(eq(tenantUsers.id, userId), eq(tenantUsers.kind, 'staff')));
      if (!user) throw notFound();
      const grants = await tx.select().from(staffRoles).where(eq(staffRoles.userId, userId));

      const oldRoles = grants.map((g) => g.role);
      const newRoles: StaffRole[] = body.role ? [body.role] : oldRoles;
      const wasActive = user.status === 'active';
      const nowActive = (body.status ?? (wasActive ? 'active' : 'disabled')) === 'active';
      if (nowActive && !wasActive && !user.passwordHash) {
        throw conflict('This person has not set a password yet');
      }

      // The last active owner stays an active owner.
      if (wasActive && oldRoles.includes('owner') && !(nowActive && newRoles.includes('owner'))) {
        const [other] = await tx
          .select({ id: staffRoles.userId })
          .from(staffRoles)
          .innerJoin(
            tenantUsers,
            and(
              eq(tenantUsers.tenantId, staffRoles.tenantId),
              eq(tenantUsers.id, staffRoles.userId),
            ),
          )
          .where(
            and(
              eq(staffRoles.role, 'owner'),
              ne(staffRoles.userId, userId),
              eq(tenantUsers.status, 'active'),
            ),
          )
          .limit(1);
        if (!other) throw conflict('An institute must keep at least one active owner');
      }

      // Seats: only when this change newly occupies one.
      for (const seat of ['teachers', 'cashiers'] as const) {
        const role = SEAT_ROLE[seat];
        const occupied = (active: boolean, roles: readonly StaffRole[]) =>
          active && roles.includes(role);
        if (occupied(nowActive, newRoles) && !occupied(wasActive, oldRoles)) {
          await this.assertSeat(tx, tenantId, seat, now, userId);
        }
      }

      if (body.classScope) {
        if (!newRoles.includes('teacher')) {
          throw validation('classScope', 'Only teachers can be limited to classes');
        }
        await this.assertClasses(tx, body.classScope);
      }

      // Roles: replace the set with the requested one; teachers keep or receive the scope.
      if (body.role || body.classScope) {
        const scope = body.classScope ? [...new Set(body.classScope)] : undefined;
        if (body.role) {
          await tx
            .delete(staffRoles)
            .where(and(eq(staffRoles.userId, userId), sql`${staffRoles.role} <> ${body.role}`));
          if (!oldRoles.includes(body.role)) {
            await tx.insert(staffRoles).values({
              tenantId,
              userId,
              role: body.role,
              classScope: body.role === 'teacher' ? (scope ?? []) : null,
            });
          }
        }
        if (scope && newRoles.includes('teacher')) {
          await tx
            .update(staffRoles)
            .set({ classScope: scope })
            .where(and(eq(staffRoles.userId, userId), eq(staffRoles.role, 'teacher')));
        }
      }

      const audits: AuditEntry[] = [];
      const base = { ...actor(session, now), entity: 'staff', entityId: userId };
      if (body.role && !sameSet(oldRoles, newRoles)) {
        audits.push({
          ...base,
          action: 'staff.role_change',
          before: { roles: oldRoles },
          after: { roles: newRoles },
        });
      }
      if (body.classScope) {
        const before = grants.find((g) => g.role === 'teacher')?.classScope ?? [];
        audits.push({
          ...base,
          action: 'staff.scope_change',
          before: { classes: before.length },
          after: { classes: new Set(body.classScope).size },
        });
      }
      if (body.status && nowActive !== wasActive) {
        await tx
          .update(tenantUsers)
          .set({ status: nowActive ? 'active' : 'disabled' })
          .where(eq(tenantUsers.id, userId));
        if (!nowActive) {
          // Disabling ends every live session immediately.
          await tx
            .update(sessions)
            .set({ revokedAt: now, revokedReason: STAFF_DISABLED })
            .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)));
        }
        audits.push({ ...base, action: nowActive ? 'staff.enable' : 'staff.disable' });
      }
      await this.audit.recordMany(tx, tenantId, audits);

      return this.member(tx, userId);
    });
  }

  private async member(tx: Tx, userId: string): Promise<StaffMember> {
    const [user] = await tx.select().from(tenantUsers).where(eq(tenantUsers.id, userId));
    const roleRows = await tx.select().from(staffRoles).where(eq(staffRoles.userId, userId));
    const [last] = await tx
      .select({ last: max(sessions.createdAt) })
      .from(sessions)
      .where(eq(sessions.userId, userId));
    if (!user) throw notFound();
    return {
      id: user.id,
      displayName: user.displayName,
      phone: user.phone,
      email: user.email,
      roles: roleRows.map((r) => r.role).sort((a, b) => roleOrder(a) - roleOrder(b)),
      classScope: [
        ...new Set(roleRows.flatMap((r) => (r.role === 'teacher' ? (r.classScope ?? []) : []))),
      ],
      status: user.status,
      inviteExpiresAt: null,
      lastSignInAt: last?.last?.toISOString() ?? null,
    };
  }

  // ----- seats and checks --------------------------------------------------------------------

  /** Active members plus pending invitations holding a teacher / cashier seat. */
  private async seatUsage(tx: Tx, now: Date, exceptUserId?: string): Promise<Usage> {
    const members = await tx
      .select({ role: staffRoles.role, userId: staffRoles.userId })
      .from(staffRoles)
      .innerJoin(
        tenantUsers,
        and(eq(tenantUsers.tenantId, staffRoles.tenantId), eq(tenantUsers.id, staffRoles.userId)),
      )
      .where(
        and(
          eq(tenantUsers.status, 'active'),
          inArray(staffRoles.role, ['teacher', 'cashier']),
          exceptUserId ? ne(staffRoles.userId, exceptUserId) : undefined,
        ),
      );
    const invites = await tx
      .select({ role: staffInvites.role })
      .from(staffInvites)
      .where(and(pendingInvite(now), inArray(staffInvites.role, ['teacher', 'cashier'])));
    const used = (role: StaffRole) =>
      members.filter((m) => m.role === role).length + invites.filter((i) => i.role === role).length;
    return { teachers: used('teacher'), cashiers: used('cashier') };
  }

  /** `null` = unlimited. Plans without an entry (lite) are held to the Tutor limits. */
  private async seatLimits(tx: Tx, tenantId: string): Promise<Record<Seat, number | null>> {
    const [tenant] = await tx
      .select({ plan: tenants.plan })
      .from(tenants)
      .where(eq(tenants.id, tenantId));
    const byPlan: Partial<Record<string, PlanLimits>> = PLAN_LIMITS;
    const limits = byPlan[tenant?.plan ?? 'tutor'] ?? PLAN_LIMITS.tutor;
    const finite = (n: number) => (Number.isFinite(n) ? n : null);
    return { teachers: finite(limits.teachers), cashiers: finite(limits.cashierLogins) };
  }

  private async assertSeat(
    tx: Tx,
    tenantId: string,
    seat: Seat,
    now: Date,
    exceptUserId?: string,
  ): Promise<void> {
    const limits = await this.seatLimits(tx, tenantId);
    const usage = await this.seatUsage(tx, now, exceptUserId);
    const limit = limits[seat];
    if (limit !== null && usage[seat] >= limit) {
      throw new AppException(
        'PLAN_LIMIT',
        403,
        seat === 'teachers'
          ? 'Your plan has no free teacher seat'
          : 'Your plan has no free cashier login',
        { detail: `${usage[seat]} of ${limit} used. Upgrade your plan or free a seat first.` },
      );
    }
  }

  private async assertContactFree(
    tx: Tx,
    phone: string | undefined,
    email: string | undefined,
    now: Date,
  ): Promise<void> {
    if (phone) {
      const [user] = await tx
        .select({ id: tenantUsers.id })
        .from(tenantUsers)
        .where(eq(tenantUsers.phone, phone));
      const [invite] = await tx
        .select({ id: staffInvites.id })
        .from(staffInvites)
        .where(and(pendingInvite(now), eq(staffInvites.phone, phone)));
      if (user || invite) throw conflict('This phone number is already used at your institute');
    }
    if (email) {
      const [user] = await tx
        .select({ id: tenantUsers.id })
        .from(tenantUsers)
        .where(sql`lower(${tenantUsers.email}) = ${email}`);
      const [invite] = await tx
        .select({ id: staffInvites.id })
        .from(staffInvites)
        .where(and(pendingInvite(now), sql`lower(${staffInvites.email}) = ${email}`));
      if (user || invite) throw conflict('This email address is already used at your institute');
    }
  }

  private async assertClasses(tx: Tx, classIds: readonly string[]): Promise<void> {
    if (classIds.length === 0) return;
    const unique = [...new Set(classIds)];
    const rows = await tx
      .select({ id: classes.id })
      .from(classes)
      .where(inArray(classes.id, unique));
    if (rows.length !== unique.length) throw validation('classScope', 'Choose existing classes');
  }
}

/** Not accepted, not revoked, not expired. */
function pendingInvite(now: Date) {
  return and(
    isNull(staffInvites.acceptedAt),
    isNull(staffInvites.revokedAt),
    gt(staffInvites.expiresAt, now),
  );
}

function inviteMember(invite: typeof staffInvites.$inferSelect): StaffMember {
  return {
    id: invite.id,
    displayName: invite.displayName,
    phone: invite.phone,
    email: invite.email,
    roles: [invite.role],
    classScope: invite.classScope ?? [],
    status: 'invited',
    inviteExpiresAt: invite.expiresAt.toISOString(),
    lastSignInAt: null,
  };
}

function sameSet(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((x) => b.includes(x));
}
