import { NextRequest } from 'next/server';
import { beforeAll, describe, expect, it, vi } from 'vitest';

beforeAll(() => {
  vi.stubEnv('API_INTERNAL_URL', 'http://localhost:4000');
  vi.stubEnv('TENANT_BASE_DOMAINS', 'localhost');
  vi.stubEnv('PLATFORM_HOSTS', 'admin.localhost');
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
});
