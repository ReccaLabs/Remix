import { describe, expect, it } from 'vitest';
import {
  clearSessionCookies,
  cookieNames,
  DEV_COOKIE_NAMES,
  readCookie,
  SECURE_COOKIE_NAMES,
  serializeCookie,
} from './cookies';
import { deviceLabel, storedUserAgent, UNKNOWN_DEVICE } from './device-label';
import {
  isExpired,
  ROTATION_GRACE_SEC,
  sessionCookieMaxAge,
  sessionExpiresAt,
  shouldRotate,
  tokenIssuedAt,
  withinRotationGrace,
} from './lifetimes';
import {
  hashToken,
  isDeviceToken,
  newDeviceToken,
  newSessionToken,
  parseSessionToken,
} from './tokens';

const NOW = new Date('2026-10-02T04:30:00Z');
const sec = (n: number) => new Date(NOW.getTime() + n * 1000);

describe('session tokens', () => {
  it('are <unixSeconds>.<43 base64url chars> and unique', () => {
    const a = newSessionToken(NOW);
    const b = newSessionToken(NOW);
    expect(a).toMatch(/^1790915400\.[A-Za-z0-9_-]{43}$/);
    expect(a).not.toBe(b);
  });

  it('parse round-trips and exposes the issue-time hint', () => {
    const token = newSessionToken(NOW);
    expect(parseSessionToken(token)).toEqual({ token, issuedAtSec: 1_790_915_400 });
  });

  it.each([
    undefined,
    '',
    'abc',
    '1790915400.short',
    `1790915400.${'a'.repeat(44)}`,
    `x.${'a'.repeat(43)}`,
    `1790915400.${'a'.repeat(42)}=`,
    `1790915400.${'a'.repeat(43)};x`,
    ` 1790915400.${'a'.repeat(43)}`,
    `1234567890123.${'a'.repeat(43)}`,
  ])('rejects malformed value %j', (raw) => {
    expect(parseSessionToken(raw)).toBeNull();
  });

  it('hash is hex SHA-256 and never the token itself', () => {
    const token = newSessionToken(NOW);
    const hash = hashToken(token);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).not.toContain(token.split('.')[1]);
    expect(hashToken(token)).toBe(hash);
    expect(hashToken(`${token}x`)).not.toBe(hash);
  });

  it('device tokens are 43 base64url chars', () => {
    const d = newDeviceToken();
    expect(isDeviceToken(d)).toBe(true);
    expect(isDeviceToken(undefined)).toBe(false);
    expect(isDeviceToken(`${d}x`)).toBe(false);
    expect(isDeviceToken('a.b')).toBe(false);
  });
});

describe('cookies', () => {
  it('uses __Host- names only when secure', () => {
    expect(cookieNames(true)).toEqual({
      session: '__Host-remix_session',
      device: '__Host-remix_device',
    });
    expect(cookieNames(false)).toEqual({ session: 'remix_session', device: 'remix_device' });
  });

  it('serialises host-only, HttpOnly, Lax, Path=/ — Secure and Max-Age as asked', () => {
    expect(serializeCookie('__Host-remix_session', 'v', { secure: true, maxAge: 2_592_000 })).toBe(
      '__Host-remix_session=v; Max-Age=2592000; Path=/; HttpOnly; Secure; SameSite=Lax',
    );
    expect(serializeCookie('remix_session', 'v', { secure: false })).toBe(
      'remix_session=v; Path=/; HttpOnly; SameSite=Lax',
    );
    expect(serializeCookie('remix_session', 'v', { secure: false })).not.toMatch(/Domain/i);
  });

  it('refuses unsafe values and insecure __Host- cookies', () => {
    expect(() => serializeCookie('remix_session', 'a;b', { secure: false })).toThrow();
    expect(() => serializeCookie('remix_session', 'a\r\nb', { secure: false })).toThrow();
    expect(() => serializeCookie('__Host-remix_session', 'v', { secure: false })).toThrow();
  });

  it('clears both session cookie variants', () => {
    expect(clearSessionCookies(false)).toEqual([
      '__Host-remix_session=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax',
      'remix_session=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax',
    ]);
    expect(clearSessionCookies(true)[1]).toContain('Secure');
  });

  it('reads exactly the named cookie; duplicates are ambiguous', () => {
    const h = (cookie: string) => ({ cookie });
    expect(readCookie(h('a=1; remix_session=tok; b=2'), DEV_COOKIE_NAMES.session)).toBe('tok');
    expect(readCookie(h('remix_session=tok'), SECURE_COOKIE_NAMES.session)).toBeUndefined();
    expect(readCookie(h('xremix_session=tok'), 'remix_session')).toBeUndefined();
    expect(readCookie(h('remix_session=a; remix_session=b'), 'remix_session')).toBeUndefined();
    expect(readCookie({}, 'remix_session')).toBeUndefined();
  });
});

describe('lifetimes', () => {
  it('is 12 h, or 30 days with stay signed in — absolute', () => {
    expect(sessionExpiresAt(NOW, false).toISOString()).toBe('2026-10-02T16:30:00.000Z');
    expect(sessionExpiresAt(NOW, true).toISOString()).toBe('2026-11-01T04:30:00.000Z');
    expect(isExpired(sec(10), NOW)).toBe(false);
    expect(isExpired(NOW, NOW)).toBe(true);
  });

  it('rotates at 15 minutes, not before', () => {
    expect(shouldRotate(NOW, sec(15 * 60 - 1))).toBe(false);
    expect(shouldRotate(NOW, sec(15 * 60))).toBe(true);
    expect(tokenIssuedAt({ createdAt: NOW, rotatedAt: null })).toBe(NOW);
    expect(tokenIssuedAt({ createdAt: NOW, rotatedAt: sec(5) })).toEqual(sec(5));
  });

  it('accepts the previous token for 120 s after rotation', () => {
    expect(withinRotationGrace(NOW, sec(ROTATION_GRACE_SEC))).toBe(true);
    expect(withinRotationGrace(NOW, sec(ROTATION_GRACE_SEC + 1))).toBe(false);
    expect(withinRotationGrace(null, NOW)).toBe(false);
    expect(withinRotationGrace(sec(10), NOW)).toBe(false); // rotated "in the future": no
  });

  it('cookie Max-Age is the time left with stay signed in, none without', () => {
    const expiresAt = sessionExpiresAt(NOW, true);
    expect(sessionCookieMaxAge({ staySignedIn: true, expiresAt }, NOW)).toBe(2_592_000);
    expect(sessionCookieMaxAge({ staySignedIn: true, expiresAt }, sec(3600))).toBe(2_588_400);
    expect(sessionCookieMaxAge({ staySignedIn: false, expiresAt }, NOW)).toBeUndefined();
  });
});

describe('deviceLabel', () => {
  it.each([
    [
      'Mozilla/5.0 (Linux; Android 14; SM-A145F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36',
      'Chrome on Android',
    ],
    [
      'Mozilla/5.0 (Linux; Android 14; SM-A145F) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/26.0 Chrome/122.0.0.0 Mobile Safari/537.36',
      'Samsung Internet on Android',
    ],
    [
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
      'Safari on iPhone',
    ],
    [
      'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/129.0 Mobile/15E148 Safari/604.1',
      'Chrome on iPad',
    ],
    [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36 Edg/129.0.0.0',
      'Edge on Windows',
    ],
    [
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 14.6; rv:131.0) Gecko/20100101 Firefox/131.0',
      'Firefox on Mac',
    ],
    ['Mozilla/5.0 (X11; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0', 'Firefox on Linux'],
    ['curl/8.9.1', UNKNOWN_DEVICE],
    ['Mozilla/5.0 (Linux; Android 14)', 'Android device'],
  ])('%s → %s', (ua, label) => {
    expect(deviceLabel(ua)).toBe(label);
  });

  it('handles a missing User-Agent', () => {
    expect(deviceLabel(undefined)).toBe(UNKNOWN_DEVICE);
    expect(deviceLabel('')).toBe(UNKNOWN_DEVICE);
  });

  it('stores a cleaned, capped User-Agent', () => {
    expect(storedUserAgent('a\u0000b\nc ')).toBe('abc');
    expect(storedUserAgent('x'.repeat(600))).toHaveLength(512);
    expect(storedUserAgent('  ')).toBeNull();
    expect(storedUserAgent(undefined)).toBeNull();
  });
});
