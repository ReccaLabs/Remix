/**
 * Session timing rules (ADR 0004). Lifetimes are absolute: never extended by activity or
 * rotation. All decisions take `now` from the injected clock.
 */
export const SESSION_LIFETIME_SEC = 12 * 60 * 60;
export const STAY_SIGNED_IN_LIFETIME_SEC = 30 * 24 * 60 * 60;
/** Refresh rotates only a token at least this old. */
export const ROTATE_AFTER_SEC = 15 * 60;
/** The previous token stays valid this long after a rotation (concurrent requests, prefetch). */
export const ROTATION_GRACE_SEC = 120;
/** `sessions.last_seen_at` is written at most this often. */
export const SESSION_TOUCH_SEC = 60;
/** `devices.last_seen_at` is written at most this often. */
export const DEVICE_TOUCH_SEC = 5 * 60;
/** Device cookie Max-Age (the browser cap on cookie lifetime). */
export const DEVICE_COOKIE_MAX_AGE_SEC = 400 * 24 * 60 * 60;

const secondsBetween = (from: Date, to: Date) => (to.getTime() - from.getTime()) / 1000;

export function sessionLifetimeSec(staySignedIn: boolean): number {
  return staySignedIn ? STAY_SIGNED_IN_LIFETIME_SEC : SESSION_LIFETIME_SEC;
}

/** Absolute expiry of a session created at `now`. */
export function sessionExpiresAt(now: Date, staySignedIn: boolean): Date {
  return new Date(now.getTime() + sessionLifetimeSec(staySignedIn) * 1000);
}

export function isExpired(expiresAt: Date, now: Date): boolean {
  return expiresAt.getTime() <= now.getTime();
}

/** When the current token was issued: the last rotation, or the login. */
export function tokenIssuedAt(session: { createdAt: Date; rotatedAt: Date | null }): Date {
  return session.rotatedAt ?? session.createdAt;
}

/** Refresh rotates when the current token is at least 15 minutes old. */
export function shouldRotate(issuedAt: Date, now: Date): boolean {
  return secondsBetween(issuedAt, now) >= ROTATE_AFTER_SEC;
}

/** The previous token is accepted for 120 s after the rotation (inclusive). */
export function withinRotationGrace(rotatedAt: Date | null, now: Date): boolean {
  if (!rotatedAt) return false;
  const elapsed = secondsBetween(rotatedAt, now);
  return elapsed >= 0 && elapsed <= ROTATION_GRACE_SEC;
}

export function isStale(lastSeenAt: Date, now: Date, everySec: number): boolean {
  return secondsBetween(lastSeenAt, now) >= everySec;
}

/**
 * Session cookie Max-Age: with "stay signed in" the time left until the absolute expiry (so the
 * cookie never outlives the server-side session); without it, none — a browser-session cookie.
 */
export function sessionCookieMaxAge(
  session: { staySignedIn: boolean; expiresAt: Date },
  now: Date,
): number | undefined {
  if (!session.staySignedIn) return undefined;
  return Math.max(0, Math.floor(secondsBetween(now, session.expiresAt)));
}
