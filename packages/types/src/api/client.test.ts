import { describe, expect, it, vi } from 'vitest';
import { ApiError, createApiClient } from './client';

const TENANT_ID = '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b';
const USER_ID = '0199a1b2-c3d4-7e5f-8a9b-1c1d2e3f4a5b';

const session = {
  user: {
    id: USER_ID,
    tenantId: TENANT_ID,
    kind: 'student',
    displayName: 'Nimali Perera',
    roles: [],
    locale: 'en',
  },
  expiresAt: '2026-11-01T00:00:00.000Z',
  impersonated: false,
};

const json = (body: unknown, status = 200, type = 'application/json') =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': type } });

describe('createApiClient', () => {
  it('validates and normalises the request body, then parses the response', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => json(session));
    const api = createApiClient({ baseUrl: 'http://api.internal', fetch });

    const res = await api.call('studentLogin', { phone: '077 123 4567', password: 'secret-pass' });

    expect(res.user.displayName).toBe('Nimali Perera');
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe('http://api.internal/api/v1/auth/student/login');
    expect(init?.method).toBe('POST');
    expect(JSON.parse(String(init?.body))).toEqual({
      phone: '+94771234567',
      password: 'secret-pass',
      staySignedIn: false,
    });
    expect(new Headers(init?.headers).get('content-type')).toBe('application/json');
  });

  it('rejects an invalid body before any request is sent', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    const api = createApiClient({ fetch });

    await expect(
      api.call('studentLogin', { phone: '0112345678', password: 'x' }),
    ).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('rejects unknown fields (strict request schemas)', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    const api = createApiClient({ fetch });
    await expect(
      // @ts-expect-error — an extra field is a type error too
      api.call('studentLogin', { phone: '0771234567', password: 'secret-pass', role: 'owner' }),
    ).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('sends per-call headers (cookie + forwarded host on the server)', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => json(session));
    const api = createApiClient({
      fetch,
      headers: () => ({ cookie: 'sid=abc', 'x-forwarded-host': 'kamalphysics.remix.lk' }),
    });

    await api.call('session');

    const headers = new Headers(fetch.mock.calls[0]![1]?.headers);
    expect(headers.get('cookie')).toBe('sid=abc');
    expect(headers.get('x-forwarded-host')).toBe('kamalphysics.remix.lk');
    expect(fetch.mock.calls[0]![1]?.body).toBeUndefined();
  });

  it('returns undefined for 204 endpoints', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response(null, { status: 204 }));
    await expect(createApiClient({ fetch }).call('logout')).resolves.toBeUndefined();
  });

  it('sends a JSON body on bodyless state-changing calls (CSRF rule, ADR 0003)', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response(null, { status: 204 }));
    await createApiClient({ fetch }).call('logout');

    const init = fetch.mock.calls[0]![1];
    expect(init?.method).toBe('POST');
    expect(init?.body).toBe('{}');
    expect(new Headers(init?.headers).get('content-type')).toBe('application/json');
  });

  it('throws ApiError carrying the problem document', async () => {
    const problem = {
      type: 'https://remix.lk/problems/invalid-credentials',
      title: 'Phone number or password is incorrect',
      status: 401,
      code: 'INVALID_CREDENTIALS',
      requestId: 'req_1',
    };
    const fetch = vi.fn<typeof globalThis.fetch>(async () =>
      json(problem, 401, 'application/problem+json'),
    );

    const error = await createApiClient({ fetch })
      .call('studentLogin', { phone: '0771234567', password: 'wrong-pass' })
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).problem).toEqual(problem);
    expect((error as ApiError).status).toBe(401);
  });

  it('falls back to a generic problem when the error body is not JSON', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(
      async () =>
        new Response('<html>Bad gateway</html>', { status: 502, statusText: 'Bad Gateway' }),
    );

    const error = (await createApiClient({ fetch })
      .call('tenant')
      .catch((e: unknown) => e)) as ApiError;

    expect(error.problem).toMatchObject({ status: 502, code: 'INTERNAL', title: 'Bad Gateway' });
  });

  it('fails loudly when the response drifts from the contract', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => json({ items: [{ id: 'nope' }] }));
    await expect(createApiClient({ fetch }).call('myClasses')).rejects.toThrow();
  });
});
