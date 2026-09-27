import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isAllowedHostname, MAX_BODY_BYTES, onRequest, onRequestPost, type Env } from './lead';

const ORIGIN = 'https://remix.lk';
const URL_ = `${ORIGIN}/api/lead`;

const validBody = {
  name: 'Kamal Jayasinghe',
  phone: '077 123 4567',
  whatsappSame: true,
  institute: 'Kamal Physics',
  students: 300,
  city: 'Colombo',
  message: 'Saturday classes, about 300 students.',
  intent: 'trial',
  turnstileToken: 'test-token',
};

/** Minimal D1 fake that records every prepared statement and its bound values. */
function fakeD1(opts: { fail?: boolean } = {}) {
  const calls: { sql: string; values: unknown[] }[] = [];
  const db = {
    prepare(sql: string) {
      const call = { sql, values: [] as unknown[] };
      calls.push(call);
      const stmt = {
        bind(...values: unknown[]) {
          call.values = values;
          return stmt;
        },
        async run() {
          if (opts.fail) throw new Error('D1_ERROR: no such table: leads');
          return { success: true, meta: {}, results: [] };
        },
      };
      return stmt;
    },
  };
  return { db: db as unknown as D1Database, calls };
}

type Siteverify = { success: boolean; hostname?: string; action?: string };

function mockFetch(
  opts: { siteverify?: Siteverify; siteverifyStatus?: number; resendStatus?: number } = {},
) {
  const fn = vi.fn<typeof fetch>(async (input) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.startsWith('https://challenges.cloudflare.com/turnstile/v0/siteverify')) {
      return new Response(
        JSON.stringify(opts.siteverify ?? { success: true, hostname: 'remix.lk', action: 'lead' }),
        { status: opts.siteverifyStatus ?? 200, headers: { 'Content-Type': 'application/json' } },
      );
    }
    if (url === 'https://api.resend.com/emails') {
      return new Response('{"id":"x"}', { status: opts.resendStatus ?? 200 });
    }
    throw new Error(`unexpected fetch ${url}`);
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}

function makeRequest(
  opts: { method?: string; body?: string; headers?: Record<string, string>; url?: string } = {},
): Request {
  const method = opts.method ?? 'POST';
  return new Request(opts.url ?? URL_, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Origin: ORIGIN,
      'CF-Connecting-IP': '203.0.113.7',
      ...opts.headers,
    },
    body:
      method === 'GET' || method === 'HEAD' ? undefined : (opts.body ?? JSON.stringify(validBody)),
  });
}

function makeContext(request: Request, envOverrides: Partial<Env> = {}) {
  const d1 = fakeD1();
  const pending: Promise<unknown>[] = [];
  const env = {
    DB: d1.db,
    TURNSTILE_SECRET_KEY: 'secret',
    PAGES_PREVIEW_HOST: 'remix-site.pages.dev',
    ...envOverrides,
  } as Env;
  const context = {
    request,
    env,
    waitUntil: (p: Promise<unknown>) => pending.push(p),
    params: {},
    data: {},
    functionPath: '/api/lead',
    passThroughOnException: () => {},
    next: async () => new Response(null, { status: 404 }),
  } as unknown as EventContext<Env, string, Record<string, unknown>>;
  return { context, calls: d1.calls, pending, env };
}

async function call(request: Request, envOverrides: Partial<Env> = {}) {
  const ctx = makeContext(request, envOverrides);
  const res = await onRequest(ctx.context);
  await Promise.all(ctx.pending);
  const body = (await res.json()) as {
    ok: boolean;
    error?: string;
    issues?: { field: string; code: string }[];
  };
  return { res, body, ...ctx };
}

let logs: string[];

beforeEach(() => {
  logs = [];
  for (const level of ['info', 'warn', 'error'] as const) {
    vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
      logs.push(args.map(String).join(' '));
    });
  }
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('POST /api/lead', () => {
  it('stores a valid lead and returns 200', async () => {
    const fetchMock = mockFetch();
    const { res, body, calls } = await call(makeRequest());

    expect(res.status).toBe(200);
    expect(body).toEqual({ ok: true });
    expect(res.headers.get('Cache-Control')).toBe('no-store');

    expect(calls).toHaveLength(1);
    expect(calls[0]?.sql).toMatch(/^INSERT INTO leads/);
    expect(calls[0]?.sql).not.toContain('Kamal'); // values are bound, never interpolated
    const [
      id,
      createdAt,
      name,
      phone,
      whatsapp,
      institute,
      students,
      city,
      message,
      intent,
      country,
    ] = calls[0]?.values ?? [];
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    expect(typeof createdAt).toBe('string');
    expect([name, phone, whatsapp, institute, students, city, message, intent, country]).toEqual([
      'Kamal Jayasinghe',
      '+94771234567',
      1,
      'Kamal Physics',
      300,
      'Colombo',
      'Saturday classes, about 300 students.',
      'trial',
      null,
    ]);

    // Turnstile verified server-side with the secret and the visitor's IP.
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(String(url)).toBe('https://challenges.cloudflare.com/turnstile/v0/siteverify');
    const form = new URLSearchParams(String(init?.body));
    expect(form.get('secret')).toBe('secret');
    expect(form.get('response')).toBe('test-token');
    expect(form.get('remoteip')).toBe('203.0.113.7');
  });

  it('accepts onRequestPost directly', async () => {
    mockFetch();
    const ctx = makeContext(makeRequest());
    const res = await onRequestPost(ctx.context);
    expect(res.status).toBe(200);
  });

  it('skips email and logs only the lead id when RESEND_API_KEY is unset', async () => {
    const fetchMock = mockFetch();
    const { res } = await call(makeRequest());
    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1); // siteverify only
    expect(logs.some((l) => l.includes('lead_email_skipped'))).toBe(true);
    const all = logs.join('\n');
    expect(all).not.toMatch(/Kamal|771234567|203\.0\.113\.7|Colombo/);
  });

  it('sends a notification to sales@remix.lk through Resend when configured', async () => {
    const fetchMock = mockFetch();
    const { res } = await call(makeRequest(), { RESEND_API_KEY: 're_test' });
    expect(res.status).toBe(200);
    const resend = fetchMock.mock.calls.find(
      ([u]) => String(u) === 'https://api.resend.com/emails',
    );
    expect(resend).toBeDefined();
    const init = resend?.[1];
    expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer re_test');
    const payload = JSON.parse(String(init?.body)) as {
      to: string[];
      subject: string;
      text: string;
    };
    expect(payload.to).toEqual(['sales@remix.lk']);
    expect(payload.subject).toBe('Free trial request: Kamal Physics');
    expect(payload.text).toContain('+94771234567');
  });

  it('still returns 200 when the email provider fails (lead is stored)', async () => {
    mockFetch({ resendStatus: 500 });
    const { res, calls } = await call(makeRequest(), { RESEND_API_KEY: 're_test' });
    expect(res.status).toBe(200);
    expect(calls).toHaveLength(1);
    expect(logs.some((l) => l.includes('lead_email_failed'))).toBe(true);
  });

  it('rejects unknown fields with 400', async () => {
    const fetchMock = mockFetch();
    const { res, body, calls } = await call(
      makeRequest({ body: JSON.stringify({ ...validBody, isAdmin: true }) }),
    );
    expect(res.status).toBe(400);
    expect(body.ok).toBe(false);
    expect(body.error).toBe('invalid_input');
    expect(body.issues).toEqual([{ field: '', code: 'unrecognized_keys' }]);
    expect(JSON.stringify(body)).not.toContain('isAdmin');
    expect(calls).toHaveLength(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects a bad phone number with 400 and a field issue', async () => {
    mockFetch();
    const { res, body, calls } = await call(
      makeRequest({ body: JSON.stringify({ ...validBody, phone: '0112345678' }) }),
    );
    expect(res.status).toBe(400);
    expect(body.error).toBe('invalid_input');
    expect(body.issues?.map((i) => i.field)).toEqual(['phone']);
    expect(calls).toHaveLength(0);
  });

  it('rejects a missing turnstile token with 400', async () => {
    mockFetch();
    const noToken: Record<string, unknown> = { ...validBody };
    delete noToken.turnstileToken;
    const { res, body } = await call(makeRequest({ body: JSON.stringify(noToken) }));
    expect(res.status).toBe(400);
    expect(body.issues?.map((i) => i.field)).toEqual(['turnstileToken']);
  });

  it('rejects malformed JSON with 400', async () => {
    mockFetch();
    const { res, body } = await call(makeRequest({ body: '{"name":' }));
    expect(res.status).toBe(400);
    expect(body).toEqual({ ok: false, error: 'invalid_input' });
  });

  it('returns 403 when Turnstile says no', async () => {
    mockFetch({ siteverify: { success: false } });
    const { res, body, calls } = await call(makeRequest());
    expect(res.status).toBe(403);
    expect(body).toEqual({ ok: false, error: 'verification_failed' });
    expect(calls).toHaveLength(0);
  });

  it('returns 403 when the Turnstile token was solved on another hostname', async () => {
    mockFetch({ siteverify: { success: true, hostname: 'evil.example', action: 'lead' } });
    const { res, calls } = await call(makeRequest());
    expect(res.status).toBe(403);
    expect(calls).toHaveLength(0);
  });

  it('returns 403 when the Turnstile action does not match', async () => {
    mockFetch({ siteverify: { success: true, hostname: 'remix.lk', action: 'login' } });
    const { res } = await call(makeRequest());
    expect(res.status).toBe(403);
  });

  it('returns a generic 500 when siteverify is unreachable', async () => {
    mockFetch({ siteverifyStatus: 502 });
    const { res, body, calls } = await call(makeRequest());
    expect(res.status).toBe(500);
    expect(body).toEqual({ ok: false, error: 'server_error' });
    expect(calls).toHaveLength(0);
  });

  it('fails closed with 500 when the Turnstile secret is not configured', async () => {
    const fetchMock = mockFetch();
    const { res, body } = await call(makeRequest(), { TURNSTILE_SECRET_KEY: undefined });
    expect(res.status).toBe(500);
    expect(body).toEqual({ ok: false, error: 'server_error' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns a generic 500 without internals when D1 fails', async () => {
    mockFetch();
    const failing = fakeD1({ fail: true });
    const { res, body } = await call(makeRequest(), { DB: failing.db });
    expect(res.status).toBe(500);
    expect(body).toEqual({ ok: false, error: 'server_error' });
    expect(JSON.stringify(body)).not.toMatch(/D1|table|stack/i);
  });

  it('rejects other methods with 405', async () => {
    for (const method of ['GET', 'PUT', 'DELETE', 'OPTIONS']) {
      const { res, calls } = await call(makeRequest({ method }));
      expect(res.status).toBe(405);
      expect(res.headers.get('Allow')).toBe('POST');
      expect(calls).toHaveLength(0);
    }
  });

  it('rejects a body over 8 KB with 413', async () => {
    const fetchMock = mockFetch();
    const big = JSON.stringify({ ...validBody, message: 'x'.repeat(MAX_BODY_BYTES) });
    const { res, body, calls } = await call(makeRequest({ body: big }));
    expect(res.status).toBe(413);
    expect(body.error).toBe('invalid_input');
    expect(calls).toHaveLength(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects a non-JSON content type with 415', async () => {
    mockFetch();
    const { res } = await call(makeRequest({ headers: { 'Content-Type': 'text/plain' } }));
    expect(res.status).toBe(415);
  });

  it.each([
    ['another site', { Origin: 'https://evil.example' }],
    ['a look-alike host', { Origin: 'https://remix.lk.evil.example' }],
    ['an opaque origin', { Origin: 'null' }],
    ['a cross-site fetch', { 'Sec-Fetch-Site': 'cross-site' }],
  ])('rejects %s with 403', async (_label, headers) => {
    const fetchMock = mockFetch();
    const { res, body, calls } = await call(makeRequest({ headers }));
    expect(res.status).toBe(403);
    expect(body.error).toBe('verification_failed');
    expect(calls).toHaveLength(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects a request with no Origin header with 403', async () => {
    mockFetch();
    const req = makeRequest();
    const headers = new Headers(req.headers);
    headers.delete('Origin');
    const { res } = await call(
      new Request(URL_, { method: 'POST', headers, body: JSON.stringify(validBody) }),
    );
    expect(res.status).toBe(403);
  });

  it('accepts same-origin requests on this project’s preview deploys', async () => {
    mockFetch({
      siteverify: { success: true, hostname: 'abc123.remix-site.pages.dev', action: 'lead' },
    });
    const origin = 'https://abc123.remix-site.pages.dev';
    const { res } = await call(
      makeRequest({ url: `${origin}/api/lead`, headers: { Origin: origin } }),
    );
    expect(res.status).toBe(200);
  });
});

describe('isAllowedHostname', () => {
  it('allows only our hosts', () => {
    expect(isAllowedHostname('remix.lk')).toBe(true);
    expect(isAllowedHostname('www.remix.lk')).toBe(true);
    expect(isAllowedHostname('localhost')).toBe(true);
    expect(isAllowedHostname('kamalphysics.remix.lk')).toBe(false);
    expect(isAllowedHostname('evil.pages.dev', 'remix-site.pages.dev')).toBe(false);
    expect(isAllowedHostname('x.remix-site.pages.dev', 'remix-site.pages.dev')).toBe(true);
    expect(isAllowedHostname('x.remix-site.pages.dev')).toBe(false);
    expect(isAllowedHostname('evil.com', 'evil.com')).toBe(false); // preview host must be *.pages.dev
  });
});
