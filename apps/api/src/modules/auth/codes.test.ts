import { describe, expect, it } from 'vitest';
import {
  InMemoryRateLimiter,
  RateLimiterUnavailableError,
} from '../../common/rate-limit/rate-limiter';
import { AppException } from '../../common/errors/app-exception';
import { authSmsText } from './auth-sms.service';
import { CodeSendLimits } from './code-send-limits';
import { digestsEqual, hashCode, maskPhone, newOtpCode } from './codes';
import { isCommonPassword } from './common-passwords';

const SECRET = 'test-secret-that-is-at-least-32-characters';
const TENANT = '0193f1c2-7b1d-7c3e-9a4f-000000000001';
const OTHER_TENANT = '0193f1c2-7b1d-7c3e-9a4f-000000000002';

describe('newOtpCode', () => {
  it('is always 6 digits, leading zeros kept, and varies', () => {
    const codes = Array.from({ length: 2000 }, newOtpCode);
    for (const code of codes) expect(code).toMatch(/^\d{6}$/);
    expect(new Set(codes).size).toBeGreaterThan(1900);
  });
});

describe('hashCode / digestsEqual', () => {
  const binding = [TENANT, '+94771234567', 'password_reset'] as const;

  it('is an HMAC: hex, deterministic, and keyed by the secret', () => {
    const a = hashCode(SECRET, binding, '123456');
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(hashCode(SECRET, binding, '123456')).toBe(a);
    expect(hashCode(`${SECRET}x`, binding, '123456')).not.toBe(a);
    expect(a).not.toContain('123456');
  });

  it('binds the code to tenant, phone and purpose', () => {
    const a = hashCode(SECRET, binding, '123456');
    expect(hashCode(SECRET, [OTHER_TENANT, binding[1], binding[2]], '123456')).not.toBe(a);
    expect(hashCode(SECRET, [TENANT, '+94771234568', binding[2]], '123456')).not.toBe(a);
    expect(hashCode(SECRET, [TENANT, binding[1], 'unlock'], '123456')).not.toBe(a);
  });

  it('compares in constant time and treats length mismatches as unequal', () => {
    const a = hashCode(SECRET, binding, '123456');
    expect(digestsEqual(a, a)).toBe(true);
    expect(digestsEqual(a, hashCode(SECRET, binding, '123457'))).toBe(false);
    expect(digestsEqual(a, a.slice(1))).toBe(false);
    expect(digestsEqual(a, '')).toBe(false);
  });
});

describe('maskPhone', () => {
  it('shows only the operator prefix and last two digits', () => {
    expect(maskPhone('+94771234567')).toBe('+94 77 *** **67');
    expect(maskPhone('garbage')).toBe('***');
  });
});

describe('isCommonPassword', () => {
  it('rejects listed and single-character passwords, case-insensitively', () => {
    expect(isCommonPassword('password123')).toBe(true);
    expect(isCommonPassword('PASSWORD123')).toBe(true);
    expect(isCommonPassword('12345678')).toBe(true);
    expect(isCommonPassword('aaaaaaaaaa')).toBe(true);
    expect(isCommonPassword('correct horse battery')).toBe(false);
  });
});

describe('authSmsText', () => {
  it('names the institute and the expiry, and carries the code', () => {
    const text = authSmsText({
      kind: 'code',
      purpose: 'password_reset',
      code: '042817',
      tenantName: 'Kamal Physics',
    });
    expect(text).toBe(
      '042817 is your Kamal Physics password code. It expires in 10 minutes. Never share it.',
    );
    expect(
      authSmsText({ kind: 'code', purpose: 'two_step', code: '1', tenantName: 'K' }),
    ).toContain('sign-in code');
    expect(
      authSmsText({
        kind: 'invite',
        tenantName: 'Kamal Physics',
        link: 'https://k.remix.lk/admin/invite#t',
        expiresHours: 72,
      }),
    ).toContain('https://k.remix.lk/admin/invite#t');
  });
});

describe('CodeSendLimits', () => {
  it('allows one code per 45 s and 3 per 15 min per phone, per tenant', async () => {
    let now = 0;
    const limits = new CodeSendLimits(new InMemoryRateLimiter(() => now));
    const phone = '+94771234567';
    expect(await limits.consumeSend(TENANT, phone)).toEqual({ allowed: true });
    expect(await limits.consumeSend(TENANT, phone)).toMatchObject({ allowed: false });
    // Another institute has its own budget for the same number.
    expect(await limits.consumeSend(OTHER_TENANT, phone)).toEqual({ allowed: true });
    now += 46_000;
    expect(await limits.consumeSend(TENANT, phone)).toEqual({ allowed: true });
    now += 46_000;
    expect(await limits.consumeSend(TENANT, phone)).toEqual({ allowed: true });
    now += 46_000;
    const fourth = await limits.consumeSend(TENANT, phone);
    expect(fourth.allowed).toBe(false);
    if (!fourth.allowed) expect(fourth.retryAfterSec).toBeGreaterThan(700);
    now += 15 * 60_000;
    expect(await limits.consumeSend(TENANT, phone)).toEqual({ allowed: true });
  });

  it('reaches the lockout threshold on the 10th counted failure', async () => {
    const limits = new CodeSendLimits(new InMemoryRateLimiter());
    for (let i = 1; i < 10; i += 1) {
      expect(await limits.countFailure(TENANT, 'phone:+94770000000')).toEqual({
        reachedLockout: false,
      });
    }
    expect(await limits.countFailure(TENANT, 'phone:+94770000000')).toEqual({
      reachedLockout: true,
    });
    expect(await limits.countFailure(TENANT, 'phone:+94770000000')).toEqual({
      reachedLockout: true,
    });
  });

  it('fails closed with a 503 when the limiter is down', async () => {
    const down = new CodeSendLimits({
      consume: () => Promise.reject(new RateLimiterUnavailableError(new Error('ECONNREFUSED'))),
    });
    await expect(down.consumeSend(TENANT, '+94771234567')).rejects.toMatchObject({
      status: 503,
    });
    await expect(down.countFailure(TENANT, 'x')).rejects.toBeInstanceOf(AppException);
  });
});
