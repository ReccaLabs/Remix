import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { expectProblem } from './fixtures/problem';
import { createTestApp, HOST_A, type TestApp } from './fixtures/test-app';

describe('problem+json errors (e2e)', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(() => t.close());

  it('400 VALIDATION_FAILED with field paths', async () => {
    const res = await request(t.server)
      .post('/api/v1/test/echo')
      .set('Host', HOST_A)
      .send({ name: '', age: 'x' });
    const problem = expectProblem(res, 400, 'VALIDATION_FAILED');
    expect(problem.errors?.map((e) => e.path).sort()).toEqual(['age', 'name']);
  });

  it('400 for malformed JSON', async () => {
    const res = await request(t.server)
      .post('/api/v1/test/echo')
      .set('Host', HOST_A)
      .set('Content-Type', 'application/json')
      .send('{"name":');
    const problem = expectProblem(res, 400, 'VALIDATION_FAILED');
    expect(problem.title).toBe('Request body is not valid JSON');
  });

  it('401 UNAUTHENTICATED without a session', async () => {
    expectProblem(
      await request(t.server).get('/api/v1/test/me').set('Host', HOST_A),
      401,
      'UNAUTHENTICATED',
    );
  });

  it('403 from a Nest HttpException keeps its status but not its internal message', async () => {
    const res = await request(t.server).get('/api/v1/test/forbidden-http').set('Host', HOST_A);
    const problem = expectProblem(res, 403, 'FORBIDDEN');
    expect(problem.title).toBe('Not allowed');
    expect(res.text).not.toContain('internal reason');
  });

  it('404 NOT_FOUND for unknown routes', async () => {
    const res = await request(t.server).get('/api/v1/nope').set('Host', HOST_A);
    expectProblem(res, 404, 'NOT_FOUND');
    expect(res.text).not.toContain('Cannot GET');
  });

  it('404 TENANT_NOT_FOUND for an unknown host', async () => {
    const res = await request(t.server).get('/api/v1/test/limited').set('Host', 'nobody.remix.lk');
    expectProblem(res, 404, 'TENANT_NOT_FOUND');
  });

  it('409 from AppException carries title and detail', async () => {
    const problem = expectProblem(
      await request(t.server).get('/api/v1/test/conflict').set('Host', HOST_A),
      409,
      'CONFLICT',
    );
    expect(problem).toMatchObject({
      title: 'Already enrolled',
      detail: 'This student is already in the class.',
    });
  });

  it('413 for a body over 100 kb', async () => {
    const res = await request(t.server)
      .post('/api/v1/test/echo')
      .set('Host', HOST_A)
      .send({ name: 'x', pad: 'a'.repeat(110 * 1024) });
    expectProblem(res, 413, 'VALIDATION_FAILED');
  });

  it('500 INTERNAL for an unexpected error, leaking nothing, logged server-side', async () => {
    const res = await request(t.server).get('/api/v1/test/boom').set('Host', HOST_A);
    const problem = expectProblem(res, 500, 'INTERNAL');
    expect(problem.title).toBe('Something went wrong');
    for (const secret of ['SELECT', 'ECONNREFUSED', 'password', '+9477', 'at ', '.ts']) {
      expect(res.text).not.toContain(secret);
    }
    const logged = t.logs.lines.find(
      (l) =>
        l.msg === 'Unhandled error while processing request' && l.requestId === problem.requestId,
    );
    expect(logged).toBeDefined();
    expect(JSON.stringify(logged)).toContain('ECONNREFUSED'); // stack stays in the logs
    expect(logged?.tenantId).toBe('0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b');
  });

  it('logs a failed query without its SQL, bound params or row detail (S-02)', async () => {
    const res = await request(t.server).get('/api/v1/test/db-boom').set('Host', HOST_A);
    const problem = expectProblem(res, 500, 'INTERNAL');
    const logged = t.logs.lines.find(
      (l) =>
        l.msg === 'Unhandled error while processing request' && l.requestId === problem.requestId,
    );
    expect(logged).toBeDefined();
    const line = JSON.stringify(logged);
    for (const secret of [
      '+94771234567',
      'argon2id',
      'aGFzaGhhc2g',
      'insert into',
      'password_hash',
    ]) {
      expect(line).not.toContain(secret);
    }
    expect(line).not.toContain('already exists');
    expect(line).toContain('23505'); // the useful part survives
    expect(t.logs.text).not.toContain('argon2id');
  });
});
