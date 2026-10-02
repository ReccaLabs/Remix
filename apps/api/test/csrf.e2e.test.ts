import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { expectProblem } from './fixtures/problem';
import { createTestApp, HOST_A, type TestApp } from './fixtures/test-app';

/** The CSRF matrix of ADR 0003 against the real app (guard + body parser + routing). */
describe('CSRF guard (e2e)', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(() => t.close());

  const post = (headers: Record<string, string>, body = '{"name":"Nimali"}') => {
    let req = request(t.server).post('/api/v1/test/echo').set('Host', HOST_A);
    for (const [k, v] of Object.entries(headers)) req = req.set(k, v);
    return req.send(body);
  };
  const json = { 'Content-Type': 'application/json' };

  it('allows a same-origin browser request', async () => {
    const res = await post({
      ...json,
      Origin: `http://${HOST_A}`,
      'Sec-Fetch-Site': 'same-origin',
    });
    expect(res.status).toBe(200);
  });

  it('allows a server-to-server request (no Origin, no Sec-Fetch-Site)', async () => {
    expect((await post(json)).status).toBe(200);
  });

  it('allows Sec-Fetch-Site: none (user-initiated, e.g. bookmark)', async () => {
    expect((await post({ ...json, 'Sec-Fetch-Site': 'none' })).status).toBe(200);
  });

  it('rejects the cross-subdomain attack: Origin evil.remix.lk on kamal.remix.lk', async () => {
    const res = await post({ ...json, Origin: 'https://evil.remix.lk' });
    expectProblem(res, 403, 'CSRF_REJECTED');
  });

  it('rejects Sec-Fetch-Site: same-site (sibling tenant) even without Origin', async () => {
    expectProblem(await post({ ...json, 'Sec-Fetch-Site': 'same-site' }), 403, 'CSRF_REJECTED');
  });

  it('rejects Sec-Fetch-Site: cross-site', async () => {
    expectProblem(await post({ ...json, 'Sec-Fetch-Site': 'cross-site' }), 403, 'CSRF_REJECTED');
  });

  it('rejects Origin: null (sandboxed iframe, data: URL)', async () => {
    expectProblem(await post({ ...json, Origin: 'null' }), 403, 'CSRF_REJECTED');
  });

  it('rejects a same-host Origin with the wrong scheme or port', async () => {
    expectProblem(await post({ ...json, Origin: `https://${HOST_A}` }), 403, 'CSRF_REJECTED');
    expectProblem(await post({ ...json, Origin: `http://${HOST_A}:8080` }), 403, 'CSRF_REJECTED');
  });

  it('rejects a matching Origin when Sec-Fetch-Site says cross-site', async () => {
    const res = await post({ ...json, Origin: `http://${HOST_A}`, 'Sec-Fetch-Site': 'cross-site' });
    expectProblem(res, 403, 'CSRF_REJECTED');
  });

  it.each(['text/plain', 'application/x-www-form-urlencoded', 'multipart/form-data; boundary=x'])(
    'rejects %s bodies with 415 (CORS-safelisted types a form can send)',
    async (type) => {
      expectProblem(await post({ 'Content-Type': type }, 'name=x'), 415, 'CSRF_REJECTED');
    },
  );

  it('rejects a bodyless state-changing request without the JSON content type', async () => {
    const res = await request(t.server).post('/api/v1/auth/logout').set('Host', HOST_A);
    expectProblem(res, 415, 'CSRF_REJECTED');
  });

  it('accepts application/json with a charset parameter', async () => {
    const res = await post({ 'Content-Type': 'application/json; charset=utf-8' });
    expect(res.status).toBe(200);
  });

  it('runs before authentication: a forged logout never reaches the session lookup', async () => {
    const lookups = t.sessions.lookups;
    const res = await request(t.server)
      .post('/api/v1/auth/logout')
      .set('Host', HOST_A)
      .set('Origin', 'https://evil.remix.lk')
      .send({});
    expectProblem(res, 403, 'CSRF_REJECTED');
    expect(t.sessions.lookups).toBe(lookups);
  });

  it('never applies to safe methods', async () => {
    const res = await request(t.server)
      .get('/api/v1/test/limited')
      .set('Host', HOST_A)
      .set('Origin', 'https://evil.remix.lk')
      .set('Sec-Fetch-Site', 'cross-site');
    expect(res.status).toBe(200);
  });

  it('skips webhook routes marked @SkipCsrf (form-encoded provider callbacks)', async () => {
    const res = await request(t.server)
      .post('/api/v1/webhooks/test')
      .set('Host', HOST_A)
      .set('Content-Type', 'application/x-www-form-urlencoded')
      .send('merchant_id=1&order_id=2');
    expect(res.status).toBe(201);
  });

  it('sends no CORS headers, even to a preflight', async () => {
    const res = await request(t.server)
      .options('/api/v1/test/echo')
      .set('Host', HOST_A)
      .set('Origin', 'https://evil.remix.lk')
      .set('Access-Control-Request-Method', 'POST');
    expect(Object.keys(res.headers).filter((h) => h.startsWith('access-control-'))).toEqual([]);
  });
});
