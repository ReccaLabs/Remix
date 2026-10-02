import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  applyCookieChanges,
  clearCookieHeader,
  isPrefetch,
  parseSetCookie,
  readCookie,
  refreshCandidate,
  requestRefresh,
  sessionCookieName,
  tokenIssuedAt,
} from './session-refresh';

const NOW = 1_790_000_000;
const RANDOM = 'q4D8xV2mZp9LkT3sW7nYb1cR5fH0jG6a';
const token = (issuedAt: number) => `${issuedAt}.${RANDOM}`;

afterEach(() => {
  vi.useRealTimers();
});

describe('sessionCookieName', () => {
  it('uses the __Host- name over HTTPS and the plain name over HTTP', () => {
    expect(sessionCookieName(true)).toBe('__Host-remix_session');
    expect(sessionCookieName(false)).toBe('remix_session');
  });
});

describe('readCookie', () => {
  it('reads an exact name only', () => {
    const header = 'remix_session_x=1; __Host-remix_session=a.b; remix_session=c.d';
    expect(readCookie(header, 'remix_session')).toBe('c.d');
    expect(readCookie(header, '__Host-remix_session')).toBe('a.b');
    expect(readCookie(header, 'missing')).toBeNull();
    expect(readCookie(null, 'remix_session')).toBeNull();
  });
});

describe('tokenIssuedAt', () => {
  it('reads the issue-time prefix of a well-formed token', () => {
    expect(tokenIssuedAt(token(NOW))).toBe(NOW);
  });

  it('rejects malformed values', () => {
    for (const value of [
      null,
      '',
      'abc',
      `${NOW}`,
      `${NOW}.`,
      `${NOW}.short`,
      `-${NOW}.${RANDOM}`,
      `${NOW}.5.${RANDOM}`,
      `1e9.${RANDOM}`,
      `0x10.${RANDOM}`,
      `${NOW}.${RANDOM}=`,
      `${'9'.repeat(13)}.${RANDOM}`,
      ` ${NOW}.${RANDOM}`,
    ]) {
      expect(tokenIssuedAt(value), String(value)).toBeNull();
    }
  });
});

describe('isPrefetch', () => {
  it('detects router prefetches and speculative loads', () => {
    expect(isPrefetch(new Headers({ 'next-router-prefetch': '1' }))).toBe(true);
    expect(isPrefetch(new Headers({ purpose: 'prefetch' }))).toBe(true);
    expect(isPrefetch(new Headers({ 'sec-purpose': 'prefetch;prerender' }))).toBe(true);
    expect(isPrefetch(new Headers({ 'x-middleware-prefetch': '1' }))).toBe(true);
    expect(isPrefetch(new Headers({ accept: 'text/html' }))).toBe(false);
  });
});

describe('refreshCandidate', () => {
  const input = (cookie: string, extra: Record<string, string> = {}) => ({
    area: 'tenant' as const,
    headers: new Headers({ cookie, ...extra }),
    secure: false,
    nowSeconds: NOW,
  });

  it('refreshes a tenant session that is 15 minutes old or more', () => {
    expect(refreshCandidate(input(`remix_session=${token(NOW - 900)}`))).toEqual({
      name: 'remix_session',
      value: token(NOW - 900),
    });
    expect(refreshCandidate(input(`a=1; remix_session=${token(NOW - 86_400)}`))).not.toBeNull();
  });

  it('leaves young, future-dated, missing and malformed tokens alone', () => {
    expect(refreshCandidate(input(`remix_session=${token(NOW - 899)}`))).toBeNull();
    expect(refreshCandidate(input(`remix_session=${token(NOW + 600)}`))).toBeNull();
    expect(refreshCandidate(input('other=1'))).toBeNull();
    expect(refreshCandidate(input('remix_session=garbage'))).toBeNull();
    expect(refreshCandidate(input(`remix_session=${NOW - 900}`))).toBeNull();
  });

  it('never refreshes for prefetches', () => {
    const old = `remix_session=${token(NOW - 3600)}`;
    expect(refreshCandidate(input(old, { 'next-router-prefetch': '1' }))).toBeNull();
    expect(refreshCandidate(input(old, { purpose: 'prefetch' }))).toBeNull();
  });

  it('never refreshes outside the tenant area', () => {
    const headers = new Headers({ cookie: `remix_session=${token(NOW - 3600)}` });
    expect(refreshCandidate({ area: 'platform', headers, secure: false, nowSeconds: NOW })).toBe(
      null,
    );
    expect(refreshCandidate({ area: null, headers, secure: false, nowSeconds: NOW })).toBeNull();
  });

  it('reads only the cookie name for the scheme', () => {
    const plain = `remix_session=${token(NOW - 3600)}`;
    const prefixed = `__Host-remix_session=${token(NOW - 3600)}`;
    expect(refreshCandidate({ ...input(plain), secure: true })).toBeNull();
    expect(refreshCandidate({ ...input(prefixed), secure: true })?.name).toBe(
      '__Host-remix_session',
    );
    expect(refreshCandidate(input(prefixed))).toBeNull();
  });
});

describe('parseSetCookie', () => {
  it('reads name and value', () => {
    expect(
      parseSetCookie(`remix_session=${token(NOW)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=60`),
    ).toEqual({ name: 'remix_session', value: token(NOW) });
    expect(parseSetCookie('__Host-remix_session=v; Path=/; Secure')).toEqual({
      name: '__Host-remix_session',
      value: 'v',
    });
  });

  it('treats Max-Age ≤ 0 and past Expires as deletion', () => {
    expect(parseSetCookie('remix_session=; Path=/; Max-Age=0')).toEqual({
      name: 'remix_session',
      value: null,
    });
    expect(
      parseSetCookie('remix_session=x; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT'),
    ).toEqual({ name: 'remix_session', value: null });
  });

  it('rejects headers without a name', () => {
    expect(parseSetCookie('=x; Path=/')).toBeNull();
    expect(parseSetCookie('garbage')).toBeNull();
  });
});

describe('applyCookieChanges', () => {
  it('swaps the rotated token in place and keeps the other cookies', () => {
    expect(
      applyCookieChanges('a=1; remix_session=old; remix_device=d', [
        { name: 'remix_session', value: 'new' },
      ]),
    ).toBe('a=1; remix_session=new; remix_device=d');
  });

  it('appends new cookies and removes deleted ones', () => {
    expect(applyCookieChanges('a=1', [{ name: 'remix_device', value: 'd' }])).toBe(
      'a=1; remix_device=d',
    );
    expect(
      applyCookieChanges('a=1; remix_session=old', [{ name: 'remix_session', value: null }]),
    ).toBe('a=1');
    expect(applyCookieChanges('remix_session=old', [{ name: 'remix_session', value: null }])).toBe(
      null,
    );
    expect(applyCookieChanges(null, [{ name: 'remix_session', value: 'v' }])).toBe(
      'remix_session=v',
    );
  });

  it('does not touch look-alike names', () => {
    expect(
      applyCookieChanges('remix_session_x=1; remix_session=old', [
        { name: 'remix_session', value: 'new' },
      ]),
    ).toBe('remix_session_x=1; remix_session=new');
  });
});

describe('clearCookieHeader', () => {
  it('expires the cookie with the attributes it was set with', () => {
    expect(clearCookieHeader('remix_session', false)).toBe(
      'remix_session=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax',
    );
    expect(clearCookieHeader('__Host-remix_session', true)).toMatch(/; Secure$/);
  });
});

describe('requestRefresh', () => {
  const headers = new Headers({ cookie: 'remix_session=x', 'x-forwarded-host': 'a.localhost' });

  it('POSTs {} as JSON with the forwarded headers', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response(null, { status: 200 }));
    await requestRefresh({ apiUrl: 'http://api:4000', headers, fetch });
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe('http://api:4000/api/v1/auth/session/refresh');
    expect(init?.method).toBe('POST');
    expect(init?.body).toBe('{}');
    const sent = new Headers(init?.headers);
    expect(sent.get('content-type')).toBe('application/json');
    expect(sent.get('cookie')).toBe('remix_session=x');
    expect(sent.get('x-forwarded-host')).toBe('a.localhost');
    expect(sent.has('origin')).toBe(false);
  });

  it('returns every Set-Cookie on 200', async () => {
    const res = new Response('{}', { status: 200 });
    res.headers.append('set-cookie', 'remix_session=new; Path=/');
    res.headers.append('set-cookie', 'remix_device=d; Path=/');
    const outcome = await requestRefresh({
      apiUrl: 'http://api',
      headers,
      fetch: async () => res,
    });
    expect(outcome).toEqual({
      kind: 'rotated',
      setCookies: ['remix_session=new; Path=/', 'remix_device=d; Path=/'],
    });
  });

  it('reports an ended session on 401 and changes nothing otherwise', async () => {
    const respond = (status: number) => async () => new Response(null, { status });
    await expect(
      requestRefresh({ apiUrl: 'http://api', headers, fetch: respond(401) }),
    ).resolves.toEqual({ kind: 'expired' });
    for (const status of [403, 404, 500, 503]) {
      await expect(
        requestRefresh({ apiUrl: 'http://api', headers, fetch: respond(status) }),
      ).resolves.toEqual({ kind: 'unchanged' });
    }
  });

  it('never throws on network errors or timeouts', async () => {
    await expect(
      requestRefresh({
        apiUrl: 'http://api',
        headers,
        fetch: async () => {
          throw new TypeError('fetch failed');
        },
      }),
    ).resolves.toEqual({ kind: 'unchanged' });

    const hang: typeof fetch = (_input, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal?.reason));
      });
    await expect(
      requestRefresh({ apiUrl: 'http://api', headers, fetch: hang, timeoutMs: 20 }),
    ).resolves.toEqual({ kind: 'unchanged' });
  });
});
