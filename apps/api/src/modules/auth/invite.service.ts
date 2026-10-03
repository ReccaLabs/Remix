import type { IncomingHttpHeaders } from 'node:http';
import { Inject, Injectable } from '@nestjs/common';
import { and, eq, gt, isNull, sql } from 'drizzle-orm';
import { schema, withTenant, type Db, type Tx } from '@remix/db';
import {
  INVITE_TTL_HOURS,
  tenantAccess,
  type InvitePreview,
  type StaffRole,
} from '@remix/types/api';
import { AppException } from '../../common/errors/app-exception';
import { currentContext } from '../../common/context/request-context';
import { tenantUnavailable } from '../../common/tenant/tenant-access.guard';
import type { ResolvedTenant } from '../../common/tenant/tenant-resolver';
import { CLOCK, type Clock } from '../../common/time/clock';
import { AuditService } from '../audit/audit.service';
import { DB } from '../db/db.module';
import { AuthSmsService } from './auth-sms.service';
import { isCommonPassword } from './common-passwords';
import { sessionExpiresAt } from './lifetimes';
import { commonPasswordRejected } from './otp.service';
import { PasswordService } from './passwords';
import { SessionIssuer, type LoginResult } from './session-issuer';
import { hashToken, isOpaqueToken } from './tokens';

const { staffInvites, tenantUsers, staffRoles, tenants } = schema;

/** 400 `INVITE_INVALID` — the same for an unknown, spent, revoked or expired invitation. */
export function inviteInvalid(): AppException {
  return new AppException('INVITE_INVALID', 400, 'This invitation link is not valid', {
    detail: 'It may have expired or been used. Ask the institute owner for a new one.',
  });
}

interface OpenInvite {
  id: string;
  displayName: string;
  phone: string | null;
  email: string | null;
  role: StaffRole;
  classScope: string[] | null;
  invitedBy: string;
  expiresAt: Date;
}

/** Path of the acceptance page; the token travels only in the fragment (never sent to a server). */
export const INVITE_PATH = '/admin/invite';

/**
 * Staff invitations (AUTH-07). Track P2-B creates the `staff_invites` row (hashed token, 72 h)
 * and calls {@link notifyStaffInvited} with the raw token; this service sends the link and later
 * previews and accepts it. The token is only ever in the link fragment and in POST bodies.
 */
@Injectable()
export class InviteService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly passwords: PasswordService,
    private readonly audit: AuditService,
    private readonly issuer: SessionIssuer,
    private readonly sms: AuthSmsService,
  ) {}

  async preview(tenant: ResolvedTenant, token: string): Promise<InvitePreview> {
    if (tenantAccess(tenant.status).staff === 'none') throw tenantUnavailable();
    const now = this.clock.now();
    return withTenant(this.db, tenant.id, async (tx) => {
      const invite = await this.findOpen(tx, tenant.id, token, now);
      if (!invite) throw inviteInvalid();
      return {
        tenantName: await this.tenantName(tx, tenant.id),
        displayName: invite.displayName,
        role: invite.role,
        expiresAt: invite.expiresAt.toISOString(),
      };
    });
  }

  /**
   * Accept: spend the invitation (one conditional UPDATE — never twice), create the staff account
   * with the invited role and class scope, and sign in. A phone or email that already belongs to
   * someone at this institute is a 409 and nothing is written (the invitation stays usable after
   * the owner fixes it). No two-step here: holding the link proves the invited contact.
   */
  async accept(
    tenant: ResolvedTenant,
    input: { token: string; newPassword: string; headers: IncomingHttpHeaders },
  ): Promise<LoginResult> {
    if (tenantAccess(tenant.status).staff === 'none') throw tenantUnavailable();
    if (isCommonPassword(input.newPassword)) throw commonPasswordRejected();
    const peek = await withTenant(this.db, tenant.id, (tx) =>
      this.findOpen(tx, tenant.id, input.token, this.clock.now()),
    );
    if (!peek) throw inviteInvalid();
    const passwordHash = await this.passwords.hash(input.newPassword);

    const now = this.clock.now();
    return withTenant(this.db, tenant.id, async (tx) => {
      const invite = await this.findOpen(tx, tenant.id, input.token, now, true);
      if (!invite) throw inviteInvalid();

      const conflict = await tx
        .select({ id: tenantUsers.id })
        .from(tenantUsers)
        .where(
          and(
            eq(tenantUsers.tenantId, tenant.id),
            sql`(${invite.phone !== null ? sql`${tenantUsers.phone} = ${invite.phone}` : sql`false`}
              or ${invite.email !== null ? sql`lower(${tenantUsers.email}) = lower(${invite.email})` : sql`false`})`,
          ),
        )
        .limit(1);
      if (conflict.length > 0) {
        throw new AppException('CONFLICT', 409, 'This phone or email already has an account here', {
          detail: 'Ask the institute owner to check the invitation.',
        });
      }

      const [user] = await tx
        .insert(tenantUsers)
        .values({
          tenantId: tenant.id,
          kind: 'staff',
          phone: invite.phone,
          email: invite.email?.toLowerCase() ?? null,
          passwordHash,
          displayName: invite.displayName,
          status: 'active',
          createdAt: now,
          updatedAt: now,
        })
        .returning({ id: tenantUsers.id, locale: tenantUsers.locale });
      if (!user) throw new Error('Staff insert returned nothing');
      await tx.insert(staffRoles).values({
        tenantId: tenant.id,
        userId: user.id,
        role: invite.role,
        classScope: invite.role === 'teacher' ? (invite.classScope ?? []) : null,
      });

      const spent = await tx
        .update(staffInvites)
        .set({ acceptedAt: now, acceptedUserId: user.id })
        .where(
          and(
            eq(staffInvites.tenantId, tenant.id),
            eq(staffInvites.id, invite.id),
            isNull(staffInvites.acceptedAt),
            isNull(staffInvites.revokedAt),
            gt(staffInvites.expiresAt, now),
          ),
        )
        .returning({ id: staffInvites.id });
      if (spent.length !== 1) throw inviteInvalid();

      await this.audit.record(tx, tenant.id, {
        action: 'staff.invite.accepted',
        actorId: user.id,
        actorKind: 'staff',
        entity: 'staff_invite',
        entityId: invite.id,
        after: { userId: user.id, role: invite.role, invitedBy: invite.invitedBy },
        at: now,
      });
      await this.audit.record(tx, tenant.id, {
        action: 'auth.password.set',
        actorId: user.id,
        actorKind: 'staff',
        entity: 'tenant_user',
        entityId: user.id,
        after: { via: 'invite' },
        at: now,
      });

      const issued = await this.issuer.issue(
        tx,
        tenant.id,
        {
          id: user.id,
          kind: 'staff',
          roles: [invite.role],
          displayName: invite.displayName,
          locale: user.locale,
          mustChangePassword: false,
        },
        {
          staySignedIn: false,
          headers: input.headers,
          now,
          expiresAt: sessionExpiresAt(now, false),
          method: 'invite',
          enforceDeviceLimit: false,
        },
      );
      if (issued.status !== 'issued') throw new Error('Staff sessions are never device-limited');
      return issued.result;
    });
  }

  /**
   * Hook for P2-B's invite endpoint (`onStaffInvited`): text the invitation link
   * (`https://<this host>/admin/invite#<token>`) to the invitee's mobile through the `sms` queue.
   * Call it after the invite row is committed, with the raw token (never stored). Email delivery
   * joins when an email queue exists; until then an email-only invite is shown to the owner to
   * share. Returns whether an SMS was queued.
   */
  async notifyStaffInvited(
    tenantId: string,
    invite: { id: string; phone: string | null; token: string },
  ): Promise<boolean> {
    if (!invite.phone || !/^\+947\d{8}$/.test(invite.phone) || !isOpaqueToken(invite.token)) {
      return false;
    }
    const ctx = currentContext();
    if (!ctx?.origin) throw new Error('notifyStaffInvited must run inside the inviting request');
    const link = `${ctx.origin}${INVITE_PATH}#${invite.token}`;
    const tenantName = await withTenant(this.db, tenantId, (tx) => this.tenantName(tx, tenantId));
    await this.sms.send(tenantId, `invite-${invite.id}`, invite.phone, {
      kind: 'invite',
      tenantName,
      link,
      expiresHours: INVITE_TTL_HOURS,
    });
    return true;
  }

  private async findOpen(
    tx: Tx,
    tenantId: string,
    token: string,
    now: Date,
    forUpdate = false,
  ): Promise<OpenInvite | null> {
    if (!isOpaqueToken(token)) return null;
    const query = tx
      .select({
        id: staffInvites.id,
        displayName: staffInvites.displayName,
        phone: staffInvites.phone,
        email: staffInvites.email,
        role: staffInvites.role,
        classScope: staffInvites.classScope,
        invitedBy: staffInvites.invitedBy,
        expiresAt: staffInvites.expiresAt,
      })
      .from(staffInvites)
      .where(
        and(
          eq(staffInvites.tenantId, tenantId),
          eq(staffInvites.tokenHash, hashToken(token)),
          isNull(staffInvites.acceptedAt),
          isNull(staffInvites.revokedAt),
          gt(staffInvites.expiresAt, now),
        ),
      )
      .limit(1);
    const [row] = forUpdate ? await query.for('update') : await query;
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
