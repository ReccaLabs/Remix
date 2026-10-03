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
  /** DEVICE_LIMIT without a usable challenge (the form normally shows the device chooser). */
  | { key: 'deviceLimit' }
  /** AUTH-09 — the message links to the SMS unlock flow. */
  | { key: 'accountLocked' }
  /** AUTH-05 — a two-step role whose account has no mobile number (403 FORBIDDEN at staff login). */
  | { key: 'twoStepNoPhone' }
  /** AUTH-02/05 — wrong, expired or burnt SMS code or ticket. */
  | { key: 'codeInvalid' }
  | { key: 'ticketExpired' }
  | { key: 'commonPassword' }
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
      case 'ACCOUNT_LOCKED':
        return { key: 'accountLocked' };
      case 'CODE_INVALID':
        return { key: 'codeInvalid' };
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

/**
 * Errors of the SMS-code steps (AUTH-02/05/07/09), which are not a login: a server-side
 * validation failure on `newPassword` is the common-password check, and a spent or expired
 * ticket at the password step means "start again".
 */
export function codeStepErrorFor(
  err: unknown,
  step: 'request' | 'verify' | 'password',
  retryAfterSeconds: number | null = null,
): LoginError {
  if (err instanceof ApiError) {
    const { code, errors } = err.problem;
    if (code === 'VALIDATION_FAILED' && errors?.some((e) => e.path === 'newPassword')) {
      return { key: 'commonPassword' };
    }
    if (code === 'CODE_INVALID' && step === 'password') return { key: 'ticketExpired' };
    if (code === 'VALIDATION_FAILED') return { key: step === 'verify' ? 'codeInvalid' : 'unexpected' };
  }
  return loginErrorFor(err, retryAfterSeconds);
}
