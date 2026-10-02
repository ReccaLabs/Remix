import type { IncomingMessage } from 'node:http';
import { Inject, Injectable } from '@nestjs/common';
import { and, eq, isNull, or, sql } from 'drizzle-orm';
import { schema, withTenant, type Db, type Tx } from '@remix/db';
import type { AppLocale, SessionResponse, StaffRole, UserKind } from '@remix/types/api';
import type { AuthSession } from '../../common/auth/session-authenticator';
import { CLOCK, type Clock } from '../../common/time/clock';
import { AuditService } from '../audit/audit.service';
import { DB } from '../db/db.module';
import {
  DEVICE_TOUCH_SEC,
  isExpired,
  isStale,
  SESSION_TOUCH_SEC,
  shouldRotate,
  tokenIssuedAt,
  withinRotationGrace,
} from './lifetimes';
import { hashToken, newSessionToken } from './tokens';

const { sessions, tenantUsers, students, devices, staffRoles } = schema;

/** Why a session was revoked (`sessions.revoked_reason`). */
export type RevokeReason = 'logout' | 'reuse_detected' | 'replaced' | 'password_reset';

/** A live session as the auth module sees it, kept on the request for its handlers. */
export interface SessionRecord {
  id: string;
  tenantId: string;
  userId: string;
  familyId: string;
  deviceId: string | null;
  kind: UserKind;
  roles: StaffRole[];
  displayName: string;
  locale: AppLocale;
  staySignedIn: boolean;
  createdAt: Date;
  rotatedAt: Date | null;
  expiresAt: Date;
  impersonatedBy: string | null;
  /** The cookie carried the previous token, inside the grace window after a rotation. */
  viaPreviousToken: boolean;
  /** Hash of the token the request presented. */
  presentedHash: string;
}

export type LookupResult =
  | { status: 'ok'; session: SessionRecord }
  /** No session, or a dead one (revoked, expired, user disabled/archived, reuse detected). */
  | { status: 'none'; dead: boolean };

export type RefreshResult =
  | { rotated: true; session: SessionRecord; token: string }
  | { rotated: false; session: SessionRecord };

const records = new WeakMap<IncomingMessage, SessionRecord>();

/** The session record the authenticator found for this request (auth handlers only). */
export function sessionRecordOf(req: IncomingMessage): SessionRecord | undefined {
  return records.get(req);
}

export function attachSessionRecord(req: IncomingMessage, record: SessionRecord): void {
  records.set(req, record);
}

export function toAuthSession(record: SessionRecord): AuthSession {
  return {
    sessionId: record.id,
    userId: record.userId,
    tenantId: record.tenantId,
    kind: record.kind,
    roles: record.kind === 'staff' ? record.roles : [],
    ...(record.impersonatedBy ? { impersonatedBy: record.impersonatedBy } : {}),
  };
}

export function toSessionResponse(record: SessionRecord): SessionResponse {
  return {
    user: {
      id: record.userId,
      tenantId: record.tenantId,
      kind: record.kind,
      displayName: record.displayName,
      roles: record.kind === 'staff' ? record.roles : [],
      locale: record.locale,
    },
    expiresAt: record.expiresAt.toISOString(),
    impersonated: record.impersonatedBy !== null,
  };
}

/**
 * Session lookup, rotation and revocation (ADR 0004). Every query runs inside the host tenant's
 * `withTenant`, so a token issued by another tenant matches no row (RLS) — and the row's
 * `tenant_id` is asserted on top. All time decisions use the injected clock.
 */
@Injectable()
export class SessionService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly audit: AuditService,
  ) {}

  /**
   * Find the live session for a presented token on `tenantId`'s host:
   * - the current token, or the previous one within 120 s of a rotation → the session;
   * - the previous token after the grace → someone else holds the session: revoke the whole
   *   family, audit `session.reuse_detected`, and answer "none";
   * - revoked, expired, user not active, student archived, device signed out → "none".
   * Touches `last_seen_at` (session ≤ 1/min, device ≤ 1/5 min).
   */
  lookup(tenantId: string, token: string): Promise<LookupResult> {
    const presentedHash = hashToken(token);
    const now = this.clock.now();
    return withTenant(this.db, tenantId, async (tx): Promise<LookupResult> => {
      const rows = await tx
        .select({
          id: sessions.id,
          tenantId: sessions.tenantId,
          userId: sessions.userId,
          tokenHash: sessions.tokenHash,
          familyId: sessions.familyId,
          deviceId: sessions.deviceId,
          staySignedIn: sessions.staySignedIn,
          createdAt: sessions.createdAt,
          rotatedAt: sessions.rotatedAt,
          lastSeenAt: sessions.lastSeenAt,
          expiresAt: sessions.expiresAt,
          revokedAt: sessions.revokedAt,
          impersonatedBy: sessions.impersonatedBy,
          kind: tenantUsers.kind,
          status: tenantUsers.status,
          displayName: tenantUsers.displayName,
          locale: tenantUsers.locale,
          archivedAt: students.archivedAt,
          deviceLastSeenAt: devices.lastSeenAt,
          deviceSignedOutAt: devices.signedOutAt,
          roles: sql<StaffRole[]>`coalesce((
            select array_agg(${staffRoles.role}::text order by ${staffRoles.role})
            from ${staffRoles}
            where ${staffRoles.tenantId} = ${sessions.tenantId}
              and ${staffRoles.userId} = ${sessions.userId}
          ), '{}')`,
        })
        .from(sessions)
        .innerJoin(
          tenantUsers,
          and(eq(tenantUsers.tenantId, sessions.tenantId), eq(tenantUsers.id, sessions.userId)),
        )
        .leftJoin(
          students,
          and(eq(students.tenantId, sessions.tenantId), eq(students.userId, sessions.userId)),
        )
        .leftJoin(
          devices,
          and(eq(devices.tenantId, sessions.tenantId), eq(devices.id, sessions.deviceId)),
        )
        .where(
          and(
            eq(sessions.tenantId, tenantId),
            or(eq(sessions.tokenHash, presentedHash), eq(sessions.prevTokenHash, presentedHash)),
          ),
        )
        .limit(2);

      const row =
        rows.find((r) => r.tokenHash === presentedHash) ??
        (rows.length === 1 ? rows[0] : undefined);
      if (!row || row.tenantId !== tenantId) return { status: 'none', dead: rows.length > 0 };
      if (row.revokedAt || isExpired(row.expiresAt, now)) return { status: 'none', dead: true };

      const viaPreviousToken = row.tokenHash !== presentedHash;
      if (viaPreviousToken && !withinRotationGrace(row.rotatedAt, now)) {
        await this.revokeFamily(tx, tenantId, row.familyId, 'reuse_detected', now);
        await this.audit.record(tx, tenantId, {
          action: 'session.reuse_detected',
          actorId: row.userId,
          actorKind: row.kind,
          entity: 'session',
          entityId: row.id,
          after: { familyId: row.familyId, rotatedAt: row.rotatedAt?.toISOString() ?? null },
          at: now,
        });
        return { status: 'none', dead: true };
      }

      const inactive =
        row.status !== 'active' ||
        (row.kind === 'student' && row.archivedAt !== null) ||
        row.deviceSignedOutAt !== null;
      if (inactive) return { status: 'none', dead: true };

      if (isStale(row.lastSeenAt, now, SESSION_TOUCH_SEC)) {
        await tx
          .update(sessions)
          .set({ lastSeenAt: now })
          .where(and(eq(sessions.tenantId, tenantId), eq(sessions.id, row.id)));
      }
      if (
        row.deviceId &&
        row.deviceLastSeenAt &&
        isStale(row.deviceLastSeenAt, now, DEVICE_TOUCH_SEC)
      ) {
        await tx
          .update(devices)
          .set({ lastSeenAt: now })
          .where(and(eq(devices.tenantId, tenantId), eq(devices.id, row.deviceId)));
      }

      return {
        status: 'ok',
        session: {
          id: row.id,
          tenantId: row.tenantId,
          userId: row.userId,
          familyId: row.familyId,
          deviceId: row.deviceId,
          kind: row.kind,
          roles: row.roles,
          displayName: row.displayName,
          locale: row.locale,
          staySignedIn: row.staySignedIn,
          createdAt: row.createdAt,
          rotatedAt: row.rotatedAt,
          expiresAt: row.expiresAt,
          impersonatedBy: row.impersonatedBy,
          viaPreviousToken,
          presentedHash,
        },
      };
    });
  }

  /**
   * POST /auth/session/refresh: rotate when the current token is at least 15 minutes old,
   * otherwise a no-op. The previous token never rotates again (it is only accepted within the
   * grace window). The swap is conditional on the presented hash still being current, so two
   * concurrent refreshes rotate once; the loser is a no-op and keeps working through the grace.
   */
  async refresh(session: SessionRecord): Promise<RefreshResult> {
    const now = this.clock.now();
    if (session.viaPreviousToken || !shouldRotate(tokenIssuedAt(session), now)) {
      return { rotated: false, session };
    }
    const token = newSessionToken(now);
    const tokenHash = hashToken(token);
    const updated = await withTenant(this.db, session.tenantId, (tx) =>
      tx
        .update(sessions)
        .set({ tokenHash, prevTokenHash: session.presentedHash, rotatedAt: now })
        .where(
          and(
            eq(sessions.tenantId, session.tenantId),
            eq(sessions.id, session.id),
            eq(sessions.tokenHash, session.presentedHash),
            isNull(sessions.revokedAt),
          ),
        )
        .returning({ id: sessions.id }),
    );
    if (updated.length === 0) return { rotated: false, session };
    return {
      rotated: true,
      token,
      session: { ...session, rotatedAt: now, presentedHash: tokenHash, viaPreviousToken: false },
    };
  }

  /** Revoke one session (logout) and audit it, in one transaction. */
  async logout(session: SessionRecord): Promise<void> {
    const now = this.clock.now();
    await withTenant(this.db, session.tenantId, async (tx) => {
      const revoked = await tx
        .update(sessions)
        .set({ revokedAt: now, revokedReason: 'logout' })
        .where(
          and(
            eq(sessions.tenantId, session.tenantId),
            eq(sessions.id, session.id),
            isNull(sessions.revokedAt),
          ),
        )
        .returning({ id: sessions.id });
      if (revoked.length === 0) return;
      await this.audit.record(tx, session.tenantId, {
        action: 'auth.logout',
        actorId: session.userId,
        actorKind: session.kind,
        entity: 'session',
        entityId: session.id,
        at: now,
      });
    });
  }

  /** Revoke every live session of a family (reuse detection). */
  async revokeFamily(
    tx: Tx,
    tenantId: string,
    familyId: string,
    reason: RevokeReason,
    now: Date,
  ): Promise<void> {
    await tx
      .update(sessions)
      .set({ revokedAt: now, revokedReason: reason })
      .where(
        and(
          eq(sessions.tenantId, tenantId),
          eq(sessions.familyId, familyId),
          isNull(sessions.revokedAt),
        ),
      );
  }
}
