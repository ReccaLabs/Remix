import { ApiError } from '@remix/types/api';

/**
 * What a failed login tells the person (AUTH-01, AUTH-05). Branches on the stable API error
 * `code`, never on status or title. `invalidCredentials` is deliberately one message for every
 * mismatch: it never reveals whether the phone or email exists (ADR 0004, no enumeration).
 * Keys live in `messages/en/auth.json` under `errors`.
 */
export type LoginError =
  | { key: 'invalidCredentials' }
  | { key: 'accountDisabled' }
  | { key: 'rateLimitedSeconds'; values: { seconds: number } }
  | { key: 'rateLimitedMinutes'; values: { minutes: number } }
  | { key: 'rateLimited' }
  | { key: 'tenantUnavailable' }
  /** Placeholder until the AUTH-03 device-choice flow (Phase 2). */
  | { key: 'deviceLimit' }
  | { key: 'network' }
  | { key: 'unexpected' };

/** Longest wait we show as a number; beyond it "wait a few minutes" reads better. */
const MAX_SHOWN_SECONDS = 60 * 60;

/**
 * `Retry-After` in seconds: delta-seconds (`120`) or an HTTP date. `null` when absent,
 * unparseable or not in the future.
 */
export function parseRetryAfter(value: string | null, nowMs = Date.now()): number | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) {
    const seconds = Number(trimmed);
    return seconds > 0 ? seconds : null;
  }
  const at = Date.parse(trimmed);
  if (Number.isNaN(at)) return null;
  const seconds = Math.ceil((at - nowMs) / 1000);
  return seconds > 0 ? seconds : null;
}

/** "Try again in N" — seconds under a minute, else whole minutes rounded up. */
export function rateLimitError(retryAfterSeconds: number | null): LoginError {
  if (retryAfterSeconds === null || retryAfterSeconds > MAX_SHOWN_SECONDS) {
    return { key: 'rateLimited' };
  }
  if (retryAfterSeconds < 60) {
    return { key: 'rateLimitedSeconds', values: { seconds: retryAfterSeconds } };
  }
  return { key: 'rateLimitedMinutes', values: { minutes: Math.ceil(retryAfterSeconds / 60) } };
}

/** Map anything a login call can throw to the message to show. */
export function loginErrorFor(err: unknown, retryAfterSeconds: number | null = null): LoginError {
  if (err instanceof ApiError) {
    switch (err.problem.code) {
      case 'INVALID_CREDENTIALS':
      // The schema is shared, so a server-side validation failure means a mismatch too.
      case 'VALIDATION_FAILED':
        return { key: 'invalidCredentials' };
      case 'ACCOUNT_DISABLED':
        return { key: 'accountDisabled' };
      case 'RATE_LIMITED':
        return rateLimitError(retryAfterSeconds);
      case 'TENANT_UNAVAILABLE':
        return { key: 'tenantUnavailable' };
      case 'DEVICE_LIMIT':
        return { key: 'deviceLimit' };
      default:
        return { key: 'unexpected' };
    }
  }
  // fetch() rejects with a TypeError when the network is down; a timeout aborts.
  if (err instanceof TypeError) return { key: 'network' };
  if (err instanceof DOMException && (err.name === 'AbortError' || err.name === 'TimeoutError')) {
    return { key: 'network' };
  }
  return { key: 'unexpected' };
}
