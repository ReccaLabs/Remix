import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { expectProblem } from './fixtures/problem';
import { createTestApp, HOST_A, HOST_B, TENANT_A, type TestApp } from './fixtures/test-app';

// supertest connects from 127.0.0.1, so TRUST_PROXY=loopback makes the test client a trusted
// proxy (like the web app / edge), and TRUST_PROXY=none makes it an untrusted client.

describe('forwarding headers from a trusted proxy (e2e)', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp({ env: { TRUST_PROXY: 'loopback' } });
  });
  afterAll(() => t.close());

  it('takes host, scheme and client IP from X-Forwarded-*', async () => {
    const res = await request(t.server)
      .get('/api/v1/test/whoami')
      .set('Host', 'api.internal:4000')
      .set('X-Forwarded-Host', 'Kamal.Remix.lk.')
      .set('X-Forwarded-Proto', 'https')
      .set('X-Forwarded-For', '203.0.113.7, 127.0.0.1');
    expect(res.body).toMatchObject({
      host: HOST_A,
      protocol: 'https',
      origin: `https://${HOST_A}`,
      clientIp: '203.0.113.7',
    });
  });

  it('resolves the tenant from the forwarded host', async () => {
    const res = await request(t.server)
      .post('/api/v1/auth/student/login')
      .set('Host', 'api.internal:4000')
      .set('X-Forwarded-Host', HOST_A)
      .send({ phone: '0771234567', password: 'secret-pass' });
    expect(res.status).toBe(200);
    expect(res.body.user.tenantId).toBe(TENANT_A.id);
  });

  it('rejects a forwarded host list (smuggled value) → no tenant', async () => {
    const res = await request(t.server)
      .get('/api/v1/test/limited')
      .set('Host', HOST_A)
      .set('X-Forwarded-Host', `${HOST_B}, ${HOST_A}`);
    expectProblem(res, 404, 'TENANT_NOT_FOUND');
  });

  it('keeps the inbound x-request-id from a trusted proxy (web ↔ API correlation)', async () => {
    const res = await request(t.server)
      .get('/api/v1/test/whoami')
      .set('Host', HOST_A)
      .set('X-Request-Id', 'web-0f8c2b7e-1d2a');
    expect(res.headers['x-request-id']).toBe('web-0f8c2b7e-1d2a');
    expect(res.body.requestId).toBe('web-0f8c2b7e-1d2a');
  });

  it('replaces a malformed inbound x-request-id', async () => {
    const res = await request(t.server)
      .get('/api/v1/test/whoami')
      .set('Host', HOST_A)
      .set('X-Request-Id', 'bad id\twith "quotes"');
    expect(res.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('uses Origin with the forwarded scheme for the CSRF check', async () => {
    const res = await request(t.server)
      .post('/api/v1/test/echo')
      .set('Host', 'api.internal:4000')
      .set('X-Forwarded-Host', HOST_A)
      .set('X-Forwarded-Proto', 'https')
      .set('Origin', `https://${HOST_A}`)
      .send({ name: 'Nimali' });
    expect(res.status).toBe(200);
  });
});

describe('forwarding headers from an untrusted peer (e2e)', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp({ env: { TRUST_PROXY: 'none' } });
  });
  afterAll(() => t.close());

  it('ignores a forged X-Forwarded-Host, -Proto and -For', async () => {
    const res = await request(t.server)
      .get('/api/v1/test/whoami')
      .set('Host', HOST_B)
      .set('X-Forwarded-Host', HOST_A)
      .set('X-Forwarded-Proto', 'https')
      .set('X-Forwarded-For', '203.0.113.7');
    expect(res.body).toMatchObject({
      host: HOST_B,
      protocol: 'http',
      origin: `http://${HOST_B}`,
      clientIp: '127.0.0.1',
    });
  });

  it('a forged X-Forwarded-Host cannot select another tenant', async () => {
    const res = await request(t.server)
      .post('/api/v1/auth/student/login')
      .set('Host', 'unknown.remix.lk')
      .set('X-Forwarded-Host', HOST_A)
      .send({ phone: '0771234567', password: 'secret-pass' });
    expectProblem(res, 404, 'TENANT_NOT_FOUND');
  });

  it('a forged X-Forwarded-Host cannot make a cross-site Origin look same-origin', async () => {
    const res = await request(t.server)
      .post('/api/v1/test/echo')
      .set('Host', HOST_A)
      .set('X-Forwarded-Host', 'evil.remix.lk')
      .set('Origin', 'http://evil.remix.lk')
      .send({ name: 'x' });
    expectProblem(res, 403, 'CSRF_REJECTED');
  });

  it('always generates its own request id', async () => {
    const res = await request(t.server)
      .get('/api/v1/test/whoami')
      .set('Host', HOST_A)
      .set('X-Request-Id', 'attacker-chosen-id');
    expect(res.headers['x-request-id']).not.toBe('attacker-chosen-id');
    expect(res.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });
});
