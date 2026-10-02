import { ApiError } from '@remix/types/api';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Request headers as the proxy would leave them, swapped per test.
let requestHeaders = new Headers();
vi.mock('next/headers', () => ({ headers: async () => requestHeaders }));
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND');
  },
  redirect: (to: string) => {
    throw new Error(`NEXT_REDIRECT ${to}`);
  },
}));

const {
  createServerApi,
  fetchSession,
  fetchTenant,
  forwardedHeaders,
  getSession,
  getTenant,
  problemCode,
  requireStaff,
  requireStudent,
} = await import('./api');

const TENANT_ID = '0193f1c2-7b1d-7c3e-9a4f-2b9c1d0e8f7a';
const OTHER_TENANT_ID = '0193f1c2-7b1d-7c3e-9a4f-000000000000';

const tenant = {
  id: TENANT_ID,
  slug: 'kamalphysics',
  name: 'Kamal Physics',
  status: 'active',
  plan: 'institute',
  defaultLocale: 'en',
  timezone: 'Asia/Colombo',
  brandColor: null,
  logoUrl: null,
};

function session(kind: 'student' | 'staff', roles: string[] = [], tenantId = TENANT_ID) {
  return {
    user: {
      id: '0193f1c2-7b1d-7c3e-9a4f-111111111111',
      tenantId,
      kind,
      displayName: 'Sample User',
      roles,
      locale: 'en',
    },
    expiresAt: '2026-11-01T00:00:00.000Z',
    impersonated: false,
  };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': status >= 400 ? 'application/problem+json' : 'application/json' },
  });

const problem = (status: number, code: string) =>
  json({ type: 'about:blank', title: code, status, code }, status);

/** A fake API: answers by path. */
function mockApi(routes: Record<string, () => Response>) {
  return vi.fn<typeof fetch>(async (input) => {
    const path = new URL(String(input)).pathname;
    const handler = routes[path];
    return handler ? handler() : problem(404, 'NOT_FOUND');
  });
}

const ctx = {
  host: 'kamalphysics.localhost',
  cookie: '_ga=1; remix_session=tok; remix_device=dev',
  requestId: 'req-12345678',
  forwardedFor: '203.0.113.7',
  forwardedProto: 'https',
};

beforeEach(() => {
  vi.stubEnv('API_INTERNAL_URL', 'http://api.internal:4000');
  vi.stubEnv('TENANT_BASE_DOMAINS', 'localhost');
  vi.stubEnv('PLATFORM_HOSTS', 'admin.localhost');
  requestHeaders = new Headers({
    'x-remix-area': 'tenant',
    'x-remix-host': 'kamalphysics.localhost',
    'x-request-id': 'req-12345678',
    cookie: 'remix_session=tok',
    origin: 'https://evil.example',
    'sec-fetch-site': 'same-site',
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('forwardedHeaders', () => {
  it('forwards exactly the ADR 0006 allow-list', () => {
    const h = forwardedHeaders(ctx);
    expect(Object.fromEntries(h)).toEqual({
      cookie: 'remix_session=tok; remix_device=dev',
      'x-forwarded-host': 'kamalphysics.localhost',
      'x-forwarded-proto': 'https',
      'x-forwarded-for': '203.0.113.7',
      'x-request-id': 'req-12345678',
    });
  });

  it('omits what the request does not have', () => {
    const h = forwardedHeaders({
      host: null,
      cookie: '_ga=1',
      requestId: null,
      forwardedFor: null,
      forwardedProto: null,
    });
    expect([...h.keys()]).toEqual([]);
  });
});

describe('createServerApi', () => {
  it('calls the internal API URL with the forwarded headers and no browser CSRF headers', async () => {
    const fetch = mockApi({ '/api/v1/tenant': () => json(tenant) });
    await createServerApi(ctx, { fetch }).call('tenant');

    const [url, init] = fetch.mock.calls[0]!;
    expect(String(url)).toBe('http://api.internal:4000/api/v1/tenant');
    const sent = new Headers(init?.headers);
    expect(sent.get('x-forwarded-host')).toBe('kamalphysics.localhost');
    expect(sent.get('cookie')).toBe('remix_session=tok; remix_device=dev');
    expect(sent.has('origin')).toBe(false);
    expect(sent.has('sec-fetch-site')).toBe(false);
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });
});

describe('fetchSession', () => {
  it('returns null on 401', async () => {
    const fetch = mockApi({ '/api/v1/auth/session': () => problem(401, 'UNAUTHENTICATED') });
    await expect(fetchSession(createServerApi(ctx, { fetch }))).resolves.toBeNull();
  });

  it('returns the session when signed in', async () => {
    const fetch = mockApi({ '/api/v1/auth/session': () => json(session('student')) });
    await expect(fetchSession(createServerApi(ctx, { fetch }))).resolves.toMatchObject({
      user: { kind: 'student' },
    });
  });

  it('rethrows anything else (an API outage is not "signed out")', async () => {
    const fetch = mockApi({ '/api/v1/auth/session': () => problem(500, 'INTERNAL') });
    await expect(fetchSession(createServerApi(ctx, { fetch }))).rejects.toBeInstanceOf(ApiError);
  });
});

describe('fetchTenant', () => {
  it('returns null for an unknown host', async () => {
    const fetch = mockApi({ '/api/v1/tenant': () => problem(404, 'TENANT_NOT_FOUND') });
    await expect(fetchTenant(createServerApi(ctx, { fetch }))).resolves.toBeNull();
  });
});

describe('problemCode', () => {
  it('reads the stable API error code', async () => {
    const fetch = mockApi({ '/api/v1/me/classes': () => problem(403, 'TENANT_UNAVAILABLE') });
    const err = await createServerApi(ctx, { fetch })
      .call('myClasses')
      .catch((e: unknown) => e);
    expect(problemCode(err)).toBe('TENANT_UNAVAILABLE');
    expect(problemCode(new Error('x'))).toBeNull();
  });
});

describe('request-scoped helpers', () => {
  it('getSession returns null on 401 using the proxy-set host', async () => {
    const fetch = mockApi({ '/api/v1/auth/session': () => problem(401, 'UNAUTHENTICATED') });
    vi.stubGlobal('fetch', fetch);
    await expect(getSession()).resolves.toBeNull();
    const sent = new Headers(fetch.mock.calls[0]![1]?.headers);
    expect(sent.get('x-forwarded-host')).toBe('kamalphysics.localhost');
    expect(sent.has('origin')).toBe(false);
  });

  it('getTenant 404s when the proxy did not classify a tenant host', async () => {
    const fetch = mockApi({ '/api/v1/tenant': () => json(tenant) });
    vi.stubGlobal('fetch', fetch);
    requestHeaders.set('x-remix-area', 'platform');
    await expect(getTenant()).rejects.toThrow('NEXT_NOT_FOUND');
    requestHeaders.delete('x-remix-area');
    await expect(getTenant()).rejects.toThrow('NEXT_NOT_FOUND');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('getTenant 404s for a host the API does not know', async () => {
    vi.stubGlobal('fetch', mockApi({ '/api/v1/tenant': () => problem(404, 'TENANT_NOT_FOUND') }));
    await expect(getTenant()).rejects.toThrow('NEXT_NOT_FOUND');
  });

  it('requireStudent redirects to the student login without a student session', async () => {
    vi.stubGlobal(
      'fetch',
      mockApi({
        '/api/v1/tenant': () => json(tenant),
        '/api/v1/auth/session': () => problem(401, 'UNAUTHENTICATED'),
      }),
    );
    await expect(requireStudent()).rejects.toThrow('NEXT_REDIRECT /login');

    vi.stubGlobal(
      'fetch',
      mockApi({
        '/api/v1/tenant': () => json(tenant),
        '/api/v1/auth/session': () => json(session('staff', ['owner'])),
      }),
    );
    await expect(requireStudent()).rejects.toThrow('NEXT_REDIRECT /login');
  });

  it('requireStudent sends the visitor back to the page they asked for after login', async () => {
    vi.stubGlobal(
      'fetch',
      mockApi({
        '/api/v1/tenant': () => json(tenant),
        '/api/v1/auth/session': () => problem(401, 'UNAUTHENTICATED'),
      }),
    );
    requestHeaders.set('x-remix-path', '/app/classes?tab=1');
    await expect(requireStudent()).rejects.toThrow(
      'NEXT_REDIRECT /login?next=%2Fapp%2Fclasses%3Ftab%3D1',
    );
    // Only portal pages are offered as a return target.
    requestHeaders.set('x-remix-path', '/admin');
    await expect(requireStudent()).rejects.toThrow(/^NEXT_REDIRECT \/login$/);
    requestHeaders.set('x-remix-path', '//evil.example/app');
    await expect(requireStudent()).rejects.toThrow(/^NEXT_REDIRECT \/login$/);
  });

  it('requireStudent rejects a session from another institute', async () => {
    vi.stubGlobal(
      'fetch',
      mockApi({
        '/api/v1/tenant': () => json(tenant),
        '/api/v1/auth/session': () => json(session('student', [], OTHER_TENANT_ID)),
      }),
    );
    await expect(requireStudent()).rejects.toThrow('NEXT_REDIRECT /login');
  });

  it('requireStudent returns the session for this institute', async () => {
    vi.stubGlobal(
      'fetch',
      mockApi({
        '/api/v1/tenant': () => json(tenant),
        '/api/v1/auth/session': () => json(session('student')),
      }),
    );
    await expect(requireStudent()).resolves.toMatchObject({ user: { kind: 'student' } });
  });

  it('requireStaff redirects to the staff login and hides pages from the wrong role', async () => {
    vi.stubGlobal(
      'fetch',
      mockApi({
        '/api/v1/tenant': () => json(tenant),
        '/api/v1/auth/session': () => json(session('student')),
      }),
    );
    await expect(requireStaff()).rejects.toThrow('NEXT_REDIRECT /admin/login');
    requestHeaders.set('x-remix-path', '/admin/students');
    await expect(requireStaff()).rejects.toThrow(
      'NEXT_REDIRECT /admin/login?next=%2Fadmin%2Fstudents',
    );
    requestHeaders.delete('x-remix-path');

    vi.stubGlobal(
      'fetch',
      mockApi({
        '/api/v1/tenant': () => json(tenant),
        '/api/v1/auth/session': () => json(session('staff', ['teacher'])),
      }),
    );
    await expect(requireStaff()).resolves.toMatchObject({ user: { roles: ['teacher'] } });
    await expect(requireStaff(['owner', 'admin'])).rejects.toThrow('NEXT_NOT_FOUND');
    await expect(requireStaff(['teacher'])).resolves.toBeDefined();
  });
});
