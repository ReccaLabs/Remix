import { ApiError, ERROR_CODES, type ErrorCode } from '@remix/types/api';
import { describe, expect, it } from 'vitest';
import { loginErrorFor, parseRetryAfter, rateLimitError } from './login-errors';

const apiError = (code: ErrorCode, status = 400) =>
  new ApiError({ type: 'about:blank', title: code, status, code });

describe('loginErrorFor', () => {
  it('maps each login failure code to its own message', () => {
    expect(loginErrorFor(apiError('INVALID_CREDENTIALS', 401))).toEqual({
      key: 'invalidCredentials',
    });
    expect(loginErrorFor(apiError('ACCOUNT_DISABLED', 403))).toEqual({ key: 'accountDisabled' });
    expect(loginErrorFor(apiError('TENANT_UNAVAILABLE', 403))).toEqual({
      key: 'tenantUnavailable',
    });
    expect(loginErrorFor(apiError('DEVICE_LIMIT', 409))).toEqual({ key: 'deviceLimit' });
  });

  it('never distinguishes an unknown phone from a wrong password', () => {
    expect(loginErrorFor(apiError('VALIDATION_FAILED', 400))).toEqual({
      key: 'invalidCredentials',
    });
  });

  it('uses Retry-After for rate limits when present', () => {
    expect(loginErrorFor(apiError('RATE_LIMITED', 429), 30)).toEqual({
      key: 'rateLimitedSeconds',
      values: { seconds: 30 },
    });
    expect(loginErrorFor(apiError('RATE_LIMITED', 429), null)).toEqual({ key: 'rateLimited' });
  });

  it('treats network failures and timeouts as network problems', () => {
    expect(loginErrorFor(new TypeError('Failed to fetch'))).toEqual({ key: 'network' });
    expect(loginErrorFor(new DOMException('timed out', 'TimeoutError'))).toEqual({
      key: 'network',
    });
    expect(loginErrorFor(new DOMException('aborted', 'AbortError'))).toEqual({ key: 'network' });
  });

  it('falls back to a generic message for anything else', () => {
    for (const code of ['CSRF_REJECTED', 'INTERNAL', 'NOT_FOUND', 'FORBIDDEN'] as const) {
      expect(loginErrorFor(apiError(code, 500))).toEqual({ key: 'unexpected' });
    }
    expect(loginErrorFor(new Error('boom'))).toEqual({ key: 'unexpected' });
    expect(loginErrorFor(undefined)).toEqual({ key: 'unexpected' });
  });

  it('has a message for every error code', () => {
    for (const code of ERROR_CODES) {
      expect(loginErrorFor(apiError(code)).key).toBeTruthy();
    }
  });
});

describe('parseRetryAfter', () => {
  const now = Date.parse('2026-10-02T08:00:00Z');

  it('reads delta-seconds', () => {
    expect(parseRetryAfter('120', now)).toBe(120);
    expect(parseRetryAfter(' 5 ', now)).toBe(5);
  });

  it('reads an HTTP date', () => {
    expect(parseRetryAfter('Fri, 02 Oct 2026 08:01:30 GMT', now)).toBe(90);
  });

  it('ignores missing, past, zero and garbage values', () => {
    expect(parseRetryAfter(null, now)).toBeNull();
    expect(parseRetryAfter('', now)).toBeNull();
    expect(parseRetryAfter('0', now)).toBeNull();
    expect(parseRetryAfter('-5', now)).toBeNull();
    expect(parseRetryAfter('soon', now)).toBeNull();
    expect(parseRetryAfter('Thu, 01 Jan 1970 00:00:00 GMT', now)).toBeNull();
  });
});

describe('rateLimitError', () => {
  it('shows seconds under a minute and whole minutes above', () => {
    expect(rateLimitError(1)).toEqual({ key: 'rateLimitedSeconds', values: { seconds: 1 } });
    expect(rateLimitError(59)).toEqual({ key: 'rateLimitedSeconds', values: { seconds: 59 } });
    expect(rateLimitError(60)).toEqual({ key: 'rateLimitedMinutes', values: { minutes: 1 } });
    expect(rateLimitError(61)).toEqual({ key: 'rateLimitedMinutes', values: { minutes: 2 } });
    expect(rateLimitError(900)).toEqual({ key: 'rateLimitedMinutes', values: { minutes: 15 } });
  });

  it('falls back to "a few minutes" without a usable value', () => {
    expect(rateLimitError(null)).toEqual({ key: 'rateLimited' });
    expect(rateLimitError(24 * 3600)).toEqual({ key: 'rateLimited' });
  });
});
