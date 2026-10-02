import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AuthSession } from '../src/common/auth/session-authenticator';
import { createTestApp, HOST_A, TENANT_A, type TestApp } from './fixtures/test-app';

const session: AuthSession = {
  sessionId: 's1',
  userId: '0199a1b2-c3d4-7e5f-8a9b-5c1d2e3f4a5b',
  tenantId: TENANT_A.id,
  kind: 'student',
  roles: [],
};

describe('request context + structured logs (e2e)', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
    t.sessions.add('tok-123', session);
  });
  afterAll(() => t.close());

  const linesFor = (requestId: string) => t.logs.lines.filter((l) => l.requestId === requestId);

  it('echoes a fresh UUID request id on every response', async () => {
    const a = await request(t.server).get('/api/v1/test/limited').set('Host', HOST_A);
    const b = await request(t.server).get('/api/v1/test/limited').set('Host', HOST_A);
    expect(a.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
    expect(a.headers['x-request-id']).not.toBe(b.headers['x-request-id']);
  });

  it('every line of a request carries requestId, tenantId and userId', async () => {
    const res = await request(t.server)
      .get('/api/v1/test/me')
      .set('Host', HOST_A)
      .set('Cookie', 'sid=tok-123');
    expect(res.status).toBe(200);
    const id = res.headers['x-request-id'] as string;
    const lines = linesFor(id);

    const handler = lines.find((l) => l.msg === 'handling /test/me');
    expect(handler).toMatchObject({ requestId: id, tenantId: TENANT_A.id, userId: session.userId });
    const completed = lines.find((l) => l.msg === 'request completed');
    expect(completed).toMatchObject({
      requestId: id,
      tenantId: TENANT_A.id,
      userId: session.userId,
    });
    expect(completed?.req).toEqual({ id, method: 'GET', url: '/api/v1/test/me' });
  });

  it('keeps the context across the JSON body parser', async () => {
    const res = await request(t.server)
      .post('/api/v1/auth/student/login')
      .set('Host', HOST_A)
      .send({ phone: '0779998888', password: 'secret-pass' });
    expect(res.status).toBe(200);
    const completed = linesFor(res.headers['x-request-id'] as string).find(
      (l) => l.msg === 'request completed',
    );
    expect(completed).toMatchObject({ tenantId: TENANT_A.id });
  });

  it('never logs cookies, auth headers, query strings, bodies or IPs', async () => {
    const res = await request(t.server)
      .post('/api/v1/auth/student/login?token=abc')
      .set('Host', HOST_A)
      .set('Cookie', 'sid=tok-123')
      .set('Authorization', 'Bearer xyz')
      .set('X-Forwarded-For', '203.0.113.9')
      .send({ phone: '0775554444', password: 'super-secret' });
    expect(res.status).toBe(200);
    const text = JSON.stringify(linesFor(res.headers['x-request-id'] as string));
    for (const secret of [
      'tok-123',
      'Bearer',
      'token=abc',
      'super-secret',
      '0775554444',
      '203.0.113.9',
    ]) {
      expect(text).not.toContain(secret);
    }
  });

  it('redacts secret-looking fields in objects logged by hand', async () => {
    const res = await request(t.server).get('/api/v1/test/log').set('Host', HOST_A);
    const line = linesFor(res.headers['x-request-id'] as string).find((l) => l.msg === 'handled');
    expect(line).toMatchObject({ password: '[redacted]', nested: { token: '[redacted]' } });
    expect(JSON.stringify(line)).not.toMatch(/hunter2|t0ken/);
  });
});
