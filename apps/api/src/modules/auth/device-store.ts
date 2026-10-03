import { and, desc, eq, gt, isNull, ne, sql } from 'drizzle-orm';
import { schema, type Tx } from '@remix/db';

const { devices, sessions } = schema;

/** Why a session was revoked (`sessions.revoked_reason`). */
export type RevokeReason =
  | 'logout'
  | 'reuse_detected'
  | 'replaced'
  | 'password_reset'
  | 'password_change'
  | 'device_signed_out'
  | 'admin_password_reset';

export interface ActiveDevice {
  id: string;
  label: string;
  firstSeenAt: Date;
  lastSeenAt: Date;
}

/**
 * A device is *active* when it is not signed out and still has a live, non-impersonation
 * session. Only active devices count toward the student limit (AUTH-03) and appear in the device
 * lists (AUTH-04/08); a device whose sessions all ended is effectively signed out already.
 */
const hasLiveSession = (now: Date) => sql`exists (
  select 1 from ${sessions}
  where ${sessions.tenantId} = ${devices.tenantId}
    and ${sessions.deviceId} = ${devices.id}
    and ${sessions.revokedAt} is null
    and ${sessions.expiresAt} > ${now}
    and ${sessions.impersonatedBy} is null
)`;

/** The user's active devices, most recently used first. */
export function activeDevices(
  tx: Tx,
  tenantId: string,
  userId: string,
  now: Date,
): Promise<ActiveDevice[]> {
  return tx
    .select({
      id: devices.id,
      label: devices.label,
      firstSeenAt: devices.firstSeenAt,
      lastSeenAt: devices.lastSeenAt,
    })
    .from(devices)
    .where(
      and(
        eq(devices.tenantId, tenantId),
        eq(devices.userId, userId),
        isNull(devices.signedOutAt),
        hasLiveSession(now),
      ),
    )
    .orderBy(desc(devices.lastSeenAt), desc(devices.id));
}

/**
 * Sign one of `userId`'s devices out: `signed_out_at/by` set, its trust cleared and every live
 * session on it revoked — in the caller's transaction. False when the device is not this user's
 * or is already signed out (callers answer 404, never revealing which).
 */
export async function signOutDevice(
  tx: Tx,
  tenantId: string,
  input: { userId: string; deviceId: string; by: string; reason: RevokeReason; now: Date },
): Promise<boolean> {
  const [device] = await tx
    .update(devices)
    .set({
      signedOutAt: input.now,
      signedOutBy: input.by,
      trustTokenHash: null,
      trustedUntil: null,
    })
    .where(
      and(
        eq(devices.tenantId, tenantId),
        eq(devices.id, input.deviceId),
        eq(devices.userId, input.userId),
        isNull(devices.signedOutAt),
      ),
    )
    .returning({ id: devices.id });
  if (!device) return false;
  await tx
    .update(sessions)
    .set({ revokedAt: input.now, revokedReason: input.reason })
    .where(
      and(
        eq(sessions.tenantId, tenantId),
        eq(sessions.deviceId, device.id),
        isNull(sessions.revokedAt),
      ),
    );
  return true;
}

/**
 * Revoke every live session of a user (password set/changed/reset), optionally sparing one.
 * Returns how many were revoked.
 */
export async function revokeUserSessions(
  tx: Tx,
  tenantId: string,
  input: { userId: string; reason: RevokeReason; now: Date; exceptSessionId?: string },
): Promise<number> {
  const rows = await tx
    .update(sessions)
    .set({ revokedAt: input.now, revokedReason: input.reason })
    .where(
      and(
        eq(sessions.tenantId, tenantId),
        eq(sessions.userId, input.userId),
        isNull(sessions.revokedAt),
        input.exceptSessionId ? ne(sessions.id, input.exceptSessionId) : undefined,
      ),
    )
    .returning({ id: sessions.id });
  return rows.length;
}

/** Forget every "trust this computer" of a user (password change/reset, AUTH-05). */
export async function clearDeviceTrust(tx: Tx, tenantId: string, userId: string): Promise<void> {
  await tx
    .update(devices)
    .set({ trustTokenHash: null, trustedUntil: null })
    .where(
      and(
        eq(devices.tenantId, tenantId),
        eq(devices.userId, userId),
        sql`${devices.trustTokenHash} is not null`,
      ),
    );
}

/** True when `trustHash` names a device of `userId` that is trusted until after `now`. */
export async function isTrusted(
  tx: Tx,
  tenantId: string,
  userId: string,
  trustHash: string,
  now: Date,
): Promise<boolean> {
  const [row] = await tx
    .select({ id: devices.id })
    .from(devices)
    .where(
      and(
        eq(devices.tenantId, tenantId),
        eq(devices.userId, userId),
        eq(devices.trustTokenHash, trustHash),
        isNull(devices.signedOutAt),
        gt(devices.trustedUntil, now),
      ),
    )
    .limit(1);
  return row !== undefined;
}
