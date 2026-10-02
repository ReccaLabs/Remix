import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AuthSession } from '../src/common/auth/session-authenticator';
import { expectProblem } from './fixtures/problem';
import {
  createTestApp,
  HOST_A,
  HOST_B,
  PLATFORM_HOST,
  TENANT_A,
  TENANT_B,
  type TestApp,
} from './fixtures/test-app';

const student: AuthSession = {
  sessionId: 's-student',
  userId: '0199a1b2-c3d4-7e5f-8a9b-1c1d2e3f4a5b',
  tenantId: TENANT_A.id,
  kind: 'student',
  roles: [],
};
const owner: AuthSession = {
  sessionId: 's-owner',
  userId: '0199a1b2-c3d4-7e5f-8a9b-2c1d2e3f4a5b',
  tenantId: TENANT_A.id,
  kind: 'staff',
  roles: ['owner'],
};
const cashierB: AuthSession = {
  sessionId: 's-cashier-b',
  userId: '0199a1b2-c3d4-7e5f-8a9b-3c1d2e3f4a5b',
  tenantId: TENANT_B.id,
  kind: 'staff',
  roles: ['cashier'],
};
const platformStaff: AuthSession = {
  sessionId: 's-platform',
  userId: '0199a1b2-c3d4-7e5f-8a9b-4c1d2e3f4a5b',
  tenantId: null,
  kind: 'platform',
  roles: [],
};

describe('tenant + auth guards (e2e)', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
    t.sessions
      .add('student', student)
      .add('owner', owner)
      .add('cashier-b', cashierB)
      .add('platform', platformStaff);
  });
  afterAll(() => t.close());

  const get = (path: string, host: string, sid?: string) => {
    const req = request(t.server).get(path).set('Host', host);
    return sid ? req.set('Cookie', `sid=${sid}`) : req;
  };

  it('deny by default: a route without @Public needs a session', async () => {
    expectProblem(await get('/api/v1/test/me', HOST_A), 401, 'UNAUTHENTICATED');
    expectProblem(await get('/api/v1/test/me', HOST_A, 'unknown-token'), 401, 'UNAUTHENTICATED');
  });

  it('a valid session on its own tenant host passes', async () => {
    const res = await get('/api/v1/test/me', HOST_A, 'student');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ userId: student.userId });
  });

  it("a tenant-B session on tenant A's host is treated as no session", async () => {
    expectProblem(await get('/api/v1/test/me', HOST_A, 'cashier-b'), 401, 'UNAUTHENTICATED');
  });

  it('a platform session is not accepted on a tenant host', async () => {
    expectProblem(await get('/api/v1/test/me', HOST_A, 'platform'), 401, 'UNAUTHENTICATED');
  });

  it('@Roles: missing role → 403, matching role → 200, no session → 401', async () => {
    expectProblem(await get('/api/v1/test/owner-only', HOST_A, 'student'), 403, 'FORBIDDEN');
    expect((await get('/api/v1/test/owner-only', HOST_A, 'owner')).status).toBe(200);
    expectProblem(await get('/api/v1/test/owner-only', HOST_A), 401, 'UNAUTHENTICATED');
  });

  it('@Public routes skip the session lookup entirely', async () => {
    const before = t.sessions.lookups;
    expect((await get('/api/v1/test/limited', HOST_B, 'student')).status).toBe(200);
    expect(t.sessions.lookups).toBe(before);
  });

  it('@Public({ optionalSession }) looks the session up but does not require it', async () => {
    const before = t.sessions.lookups;
    const res = await request(t.server).post('/api/v1/auth/logout').set('Host', HOST_A).send({});
    expect(res.status).toBe(204);
    expect(t.sessions.lookups).toBe(before + 1);
  });

  it('the registry session endpoint works end to end with a session', async () => {
    const res = await get('/api/v1/auth/session', HOST_A, 'student');
    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({ id: student.userId, tenantId: TENANT_A.id });
  });

  it('platform routes answer only on the platform host', async () => {
    expect((await get('/api/v1/platform/ping', PLATFORM_HOST)).body).toEqual({ area: 'platform' });
    expectProblem(await get('/api/v1/platform/ping', HOST_A), 404, 'NOT_FOUND');
  });

  it('tenant routes do not exist on the platform host', async () => {
    expectProblem(await get('/api/v1/test/limited', PLATFORM_HOST), 404, 'NOT_FOUND');
  });

  it('unknown hosts never reach the session lookup', async () => {
    const before = t.sessions.lookups;
    expectProblem(await get('/api/v1/test/me', 'evil.example', 'student'), 404, 'TENANT_NOT_FOUND');
    expect(t.sessions.lookups).toBe(before);
  });

  it('a malformed Host is an unknown tenant, not a crash', async () => {
    const res = await get('/api/v1/test/limited', 'kamal.remix.lk:99999');
    expectProblem(res, 404, 'TENANT_NOT_FOUND');
  });
});
