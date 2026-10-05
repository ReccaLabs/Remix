import { NextRequest } from 'next/server';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

beforeAll(() => {
  vi.stubEnv('API_INTERNAL_URL', 'http://localhost:4000');
  vi.stubEnv('TENANT_BASE_DOMAINS', 'localhost');
  vi.stubEnv('PLATFORM_HOSTS', 'admin.localhost');
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const { proxy } = await import('./proxy');

function run(url: string, headers: Record<string, string> = {}) {
  const host = new URL(url).host;
  return proxy(new NextRequest(url, { headers: { host, ...headers } }));
}

/** Where the proxy rewrote to, and the request headers it handed to the render. */
function rewrite(res: Response) {
  const target = res.headers.get('x-middleware-rewrite');
  const forwarded = (name: string) => res.headers.get(`x-middleware-request-${name}`);
  return { pathname: target ? new URL(target).pathname : null, forwarded };
}

describe('proxy', () => {
  it('rewrites a tenant host into /tenant and hands over the normalised host', async () => {
    const res = await run('http://KamalPhysics.localhost:3001/app/classes?tab=1');
    const { pathname, forwarded } = rewrite(res);
    expect(pathname).toBe('/tenant/app/classes');
    expect(new URL(res.headers.get('x-middleware-rewrite')!).search).toBe('?tab=1');
    expect(forwarded('x-remix-area')).toBe('tenant');
    expect(forwarded('x-remix-host')).toBe('kamalphysics.localhost');
  });

  it('rewrites the platform host into /platform', async () => {
    const { pathname, forwarded } = rewrite(await run('http://admin.localhost:3001/'));
    expect(pathname).toBe('/platform');
    expect(forwarded('x-remix-area')).toBe('platform');
    expect(forwarded('x-remix-host')).toBe('admin.localhost');
  });

  it('404s unknown hosts and direct requests to internal prefixes', async () => {
    for (const url of [
      'http://localhost:3001/',
      'http://127.0.0.1:3001/',
      'http://kamalphysics.localhost:3001/tenant',
      'http://kamalphysics.localhost:3001/tenant/app',
      'http://kamalphysics.localhost:3001/platform',
      'http://admin.localhost:3001/platform/institutes',
      'http://admin.localhost:3001/tenant',
    ]) {
      const { pathname, forwarded } = rewrite(await run(url));
      expect(pathname, url).toBe('/__remix_not_found');
      expect(forwarded('x-remix-area'), url).toBeNull();
      expect(forwarded('x-remix-host'), url).toBeNull();
    }
  });

  it('overwrites client-supplied area/host headers', async () => {
    const res = await run('http://kamalphysics.localhost:3001/', {
      'x-remix-area': 'platform',
      'x-remix-host': 'royalscience.localhost',
    });
    expect(rewrite(res).forwarded('x-remix-area')).toBe('tenant');
    expect(rewrite(res).forwarded('x-remix-host')).toBe('kamalphysics.localhost');

    const unknown = await run('http://localhost:3001/', {
      'x-remix-area': 'tenant',
      'x-remix-host': 'kamalphysics.localhost',
    });
    expect(rewrite(unknown).forwarded('x-remix-area')).toBeNull();
    expect(rewrite(unknown).forwarded('x-remix-host')).toBeNull();
  });

  it('sets a per-request CSP nonce on the response and for the render', async () => {
    const a = await run('http://kamalphysics.localhost:3001/');
    const b = await run('http://kamalphysics.localhost:3001/');
    const nonce = rewrite(a).forwarded('x-nonce');
    expect(nonce).toBeTruthy();
    expect(nonce).not.toBe(rewrite(b).forwarded('x-nonce'));
    expect(a.headers.get('content-security-policy')).toContain(`'nonce-${nonce}'`);
    expect(rewrite(a).forwarded('content-security-policy')).toBe(
      a.headers.get('content-security-policy'),
    );
    expect(a.headers.get('x-content-type-options')).toBe('nosniff');
    expect(a.headers.get('x-request-id')).toBe(rewrite(a).forwarded('x-request-id'));
  });

  it('sets security headers on 404s too', async () => {
    const res = await run('http://nope:3001/');
    expect(res.headers.get('content-security-policy')).toContain("frame-ancestors 'none'");
    expect(res.headers.get('referrer-policy')).toBe('strict-origin-when-cross-origin');
  });
  it('allows camera only on tenant admin pages, never the portal, platform or internal paths', async () => {
    for (const path of ['/admin', '/admin/fees/counter', '/admin/students'])
      expect(
        (await run(`http://kamalphysics.localhost:3001${path}`)).headers.get('permissions-policy'),
      ).toContain('camera=(self)');
    for (const url of [
      'http://kamalphysics.localhost:3001/app',
      'http://kamalphysics.localhost:3001/administrator',
      'http://admin.localhost:3001/admin/fees',
      'http://kamalphysics.localhost:3001/tenant/admin',
      'http://localhost:3001/admin',
    ])
      expect((await run(url)).headers.get('permissions-policy')).toContain('camera=()');
  });
});

describe('proxy session refresh', () => {
  // Freeze the clock: token ages are computed from Date.now() and a second boundary crossed
  // mid-test used to make these assertions flaky (Dependabot #28).
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const now = () => Math.floor(Date.now() / 1000);
  const token = (age: number) => `${now() - age}.q4D8xV2mZp9LkT3sW7nYb1cR5fH0jG6a`;
  const url = 'http://kamalphysics.localhost:3001/app';

  function apiReturning(res: () => Response) {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => res());
    vi.stubGlobal('fetch', fetch);
    return fetch;
  }

  it('rotates an old session: relays Set-Cookie and swaps the cookie for this render', async () => {
    const fresh = token(0);
    const fetch = apiReturning(() => {
      const res = new Response('{}', { status: 200 });
      res.headers.append('set-cookie', `remix_session=${fresh}; Path=/; HttpOnly; SameSite=Lax`);
      return res;
    });
    const res = await run(url, {
      cookie: `_ga=1; remix_session=${token(16 * 60)}; remix_device=dev`,
      'x-forwarded-for': '203.0.113.7',
      origin: 'http://kamalphysics.localhost:3001',
    });

    expect(fetch).toHaveBeenCalledOnce();
    const [calledUrl, init] = fetch.mock.calls[0]!;
    expect(calledUrl).toBe('http://localhost:4000/api/v1/auth/session/refresh');
    expect(init?.method).toBe('POST');
    expect(init?.body).toBe('{}');
    const sent = new Headers(init?.headers);
    expect(sent.get('cookie')).toBe(`remix_session=${token(16 * 60)}; remix_device=dev`);
    expect(sent.get('x-forwarded-host')).toBe('kamalphysics.localhost');
    expect(sent.get('x-forwarded-for')).toBe('203.0.113.7');
    expect(sent.get('content-type')).toBe('application/json');
    expect(sent.has('origin')).toBe(false);

    expect(res.headers.getSetCookie()).toEqual([
      `remix_session=${fresh}; Path=/; HttpOnly; SameSite=Lax`,
    ]);
    expect(rewrite(res).forwarded('cookie')).toBe(
      `_ga=1; remix_session=${fresh}; remix_device=dev`,
    );
    expect(rewrite(res).pathname).toBe('/tenant/app');
  });

  it('drops the cookie on 401 so the guard redirects to login', async () => {
    apiReturning(() => new Response(null, { status: 401 }));
    const res = await run(url, { cookie: `remix_session=${token(3600)}; theme=dark` });
    expect(res.headers.getSetCookie()).toEqual([
      'remix_session=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax',
    ]);
    expect(rewrite(res).forwarded('cookie')).toBe('theme=dark');
  });

  it('carries on untouched when the API is down', async () => {
    vi.stubGlobal('fetch', async () => {
      throw new TypeError('fetch failed');
    });
    const cookie = `remix_session=${token(3600)}`;
    const res = await run(url, { cookie });
    expect(res.headers.getSetCookie()).toEqual([]);
    expect(rewrite(res).pathname).toBe('/tenant/app');
    // Unchanged request headers are not re-sent as overrides.
    expect(rewrite(res).forwarded('cookie') ?? cookie).toBe(cookie);
  });

  it('does not call the API for young tokens, prefetches, the platform or unknown hosts', async () => {
    const fetch = apiReturning(() => new Response(null, { status: 200 }));
    await run(url, { cookie: `remix_session=${token(60)}` });
    await run(url, { cookie: `remix_session=${token(3600)}`, 'next-router-prefetch': '1' });
    await run(url, { cookie: `remix_session=${token(3600)}`, purpose: 'prefetch' });
    await run('http://admin.localhost:3001/', { cookie: `remix_session=${token(3600)}` });
    await run('http://localhost:3001/', { cookie: `remix_session=${token(3600)}` });
    await run(url, { cookie: 'remix_session=not-a-token' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('hands the browser-facing path to the render for login ?next=', async () => {
    const res = await run('http://kamalphysics.localhost:3001/app/classes?tab=2', {
      'x-remix-path': '/evil',
    });
    expect(rewrite(res).forwarded('x-remix-path')).toBe('/app/classes?tab=2');
  });
});
