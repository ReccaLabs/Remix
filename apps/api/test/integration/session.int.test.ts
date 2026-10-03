import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { schema, type Db } from '@remix/db';
import { sessionResponseSchema } from '@remix/types/api';
import { expectProblem } from '../fixtures/problem';
import {
  client,
  cookieValue,
  createDbTestApp,
  Factory,
  ownerDb,
  PASSWORD,
  setCookies,
  type DbTestApp,
  type TenantFixture,
  type UserFixture,
} from './support/db-app';

const SESSION = '/api/v1/auth/session';
const REFRESH = '/api/v1/auth/session/refresh';
const LOGOUT = '/api/v1/auth/logout';
const CLASSES = '/api/v1/me/classes';
const MIN = 60_000;
const CLEARED = [
  '__Host-remix_session=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax',
  'remix_session=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax',
];

describe('sessions (ADR 0004) against Postgres', () => {
  let t: DbTestApp;
  let db: Db;
  let f: Factory;
  let tenant: TenantFixture;

  beforeAll(async () => {
    t = await createDbTestApp();
    db = ownerDb();
    f = new Factory(db);
    tenant = await f.tenant('active');
  });
  afterAll(async () => {
    await t.close();
    await db.$client.end();
  });

  async function login(
    on: TenantFixture,
    user: UserFixture,
    kind: 'student' | 'staff' = 'student',
    staySignedIn = false,
  ): Promise<{ token: string; cookie: string }> {
    const res =
      kind === 'student'
        ? await client(t, on.host).post('/api/v1/auth/student/login', {
            phone: user.phone,
            password: PASSWORD,
            staySignedIn,
          })
        : await client(t, on.host).post('/api/v1/auth/staff/login', {
            identifier: user.phone,
            password: PASSWORD,
            staySignedIn,
          });
    expect(res.status).toBe(200);
    const token = cookieValue(setCookies(res).get('remix_session'));
    return { token, cookie: `remix_session=${token}` };
  }

  const sessionsOf = (user: UserFixture) => f.sessionsOf(user);

  it('GET /auth/session returns the signed-in user, 401 without or with a bad cookie', async () => {
    const student = await f.student(tenant, { name: 'Ishara Silva' });
    const { cookie } = await login(tenant, student);
    const ok = await client(t, tenant.host).get(SESSION, cookie);
    expect(ok.status).toBe(200);
    expect(ok.headers['cache-control']).toBe('no-store');
    const body = sessionResponseSchema.strict().parse(ok.body);
    expect(body.user).toMatchObject({ id: student.id, tenantId: tenant.id, kind: 'student' });
    expect(body.impersonated).toBe(false);

    expectProblem(await client(t, tenant.host).get(SESSION), 401, 'UNAUTHENTICATED');
    expectProblem(
      await client(t, tenant.host).get(SESSION, 'remix_session=garbage'),
      401,
      'UNAUTHENTICATED',
    );
    expectProblem(
      await client(t, tenant.host).get(SESSION, `remix_session=1790000000.${'A'.repeat(43)}`),
      401,
      'UNAUTHENTICATED',
    );
  });

  it("cross-tenant: tenant A's session cookie on tenant B's host is 401", async () => {
    const other = await f.tenant('active');
    const student = await f.student(tenant);
    const { cookie } = await login(tenant, student);
    expectProblem(await client(t, other.host).get(SESSION, cookie), 401, 'UNAUTHENTICATED');
    expectProblem(await client(t, other.host).get(CLASSES, cookie), 401, 'UNAUTHENTICATED');
    // …and it is still valid on its own host.
    expect((await client(t, tenant.host).get(SESSION, cookie)).status).toBe(200);
  });

  describe('refresh', () => {
    it('is a no-op (200, no Set-Cookie) for a token under 15 minutes old', async () => {
      const student = await f.student(tenant);
      const { cookie } = await login(tenant, student);
      t.clock.advance(14 * MIN + 59_000);
      const res = await client(t, tenant.host).post(REFRESH, {}, cookie);
      expect(res.status).toBe(200);
      expect(res.headers['set-cookie']).toBeUndefined();
      expect(res.body.user.id).toBe(student.id);
      const [row] = await sessionsOf(student);
      expect(row?.rotatedAt).toBeNull();
    });

    it('rotates at 15 minutes: new cookie, previous hash kept, expiry unchanged', async () => {
      const student = await f.student(tenant);
      const { token, cookie } = await login(tenant, student, 'student', true);
      const [before] = await sessionsOf(student);
      t.clock.advance(15 * MIN);
      const res = await client(t, tenant.host).post(REFRESH, {}, cookie);
      expect(res.status).toBe(200);
      const line = setCookies(res).get('remix_session');
      expect(line).toMatch(
        /^remix_session=\d+\.[A-Za-z0-9_-]{43}; Max-Age=2591100; Path=\/; HttpOnly; SameSite=Lax$/,
      );
      const fresh = cookieValue(line);
      expect(fresh).not.toBe(token);
      expect(Number(fresh.split('.')[0])).toBe(Math.floor(t.clock.nowMs() / 1000));
      expect(res.body.expiresAt).toBe(before?.expiresAt.toISOString());

      const [after] = await sessionsOf(student);
      expect(after?.prevTokenHash).toBe(before?.tokenHash);
      expect(after?.tokenHash).not.toBe(before?.tokenHash);
      expect(after?.rotatedAt?.getTime()).toBe(t.clock.nowMs());
      expect(after?.expiresAt.getTime()).toBe(before?.expiresAt.getTime());

      // The new token works; refreshing it straight away is a no-op.
      const again = await client(t, tenant.host).post(REFRESH, {}, `remix_session=${fresh}`);
      expect(again.status).toBe(200);
      expect(again.headers['set-cookie']).toBeUndefined();
    });

    it('accepts the previous token within 120 s of a rotation, without rotating again', async () => {
      const student = await f.student(tenant);
      const { cookie: old } = await login(tenant, student);
      t.clock.advance(20 * MIN);
      const rotated = await client(t, tenant.host).post(REFRESH, {}, old);
      const fresh = `remix_session=${cookieValue(setCookies(rotated).get('remix_session'))}`;
      const [afterRotation] = await sessionsOf(student);

      t.clock.advance(120_000);
      expect((await client(t, tenant.host).get(SESSION, old)).status).toBe(200);
      const concurrent = await client(t, tenant.host).post(REFRESH, {}, old);
      expect(concurrent.status).toBe(200);
      expect(concurrent.headers['set-cookie']).toBeUndefined();
      const [still] = await sessionsOf(student);
      expect(still?.tokenHash).toBe(afterRotation?.tokenHash);
      expect(still?.revokedAt).toBeNull();
      expect((await client(t, tenant.host).get(SESSION, fresh)).status).toBe(200);
    });

    it('previous token after the grace: the family is revoked and audited, everyone is out', async () => {
      const student = await f.student(tenant);
      const { cookie: stolen } = await login(tenant, student);
      t.clock.advance(16 * MIN);
      const rotated = await client(t, tenant.host).post(REFRESH, {}, stolen);
      const fresh = `remix_session=${cookieValue(setCookies(rotated).get('remix_session'))}`;

      t.clock.advance(121_000);
      const reuse = await client(t, tenant.host).get(SESSION, stolen);
      expectProblem(reuse, 401, 'UNAUTHENTICATED');
      expect(reuse.headers['set-cookie']).toEqual(CLEARED);

      const [row] = await sessionsOf(student);
      expect(row?.revokedReason).toBe('reuse_detected');
      expect(row?.revokedAt?.getTime()).toBe(t.clock.nowMs());
      expectProblem(await client(t, tenant.host).get(SESSION, fresh), 401, 'UNAUTHENTICATED');

      const audits = await f.audits(tenant, 'session.reuse_detected');
      const mine = audits.filter((a) => a.actorId === student.id);
      expect(mine).toHaveLength(1);
      expect(mine[0]).toMatchObject({ entity: 'session', entityId: row?.id, actorKind: 'student' });
      expect(mine[0]?.requestId).toBe(reuse.headers['x-request-id']);
      expect(JSON.stringify(mine)).not.toContain(row?.tokenHash ?? 'x');
      expect(JSON.stringify(mine)).not.toContain(row?.prevTokenHash ?? 'x');
    });

    it('two concurrent refreshes rotate once', async () => {
      const student = await f.student(tenant);
      const { cookie } = await login(tenant, student);
      t.clock.advance(15 * MIN);
      const [a, b] = await Promise.all([
        client(t, tenant.host).post(REFRESH, {}, cookie),
        client(t, tenant.host).post(REFRESH, {}, cookie),
      ]);
      expect([a.status, b.status]).toEqual([200, 200]);
      const setCount = [a, b].filter((r) => r.headers['set-cookie']).length;
      expect(setCount).toBe(1);
      const [row] = await sessionsOf(student);
      expect(row?.revokedAt).toBeNull();
    });
  });

  describe('expiry and account state', () => {
    it('a 12 h session is 401 at 12 h; a 30-day one lives until 30 days', async () => {
      const student = await f.student(tenant);
      const short = await login(tenant, student);
      const long = await login(tenant, student, 'student', true);
      t.clock.advance(12 * 60 * MIN - 1000);
      expect((await client(t, tenant.host).get(SESSION, short.cookie)).status).toBe(200);
      t.clock.advance(1000);
      const expired = await client(t, tenant.host).get(SESSION, short.cookie);
      expectProblem(expired, 401, 'UNAUTHENTICATED');
      expect(expired.headers['set-cookie']).toEqual(CLEARED);
      expect((await client(t, tenant.host).get(SESSION, long.cookie)).status).toBe(200);
      t.clock.advance(30 * 24 * 60 * MIN - 12 * 60 * MIN);
      expectProblem(await client(t, tenant.host).get(SESSION, long.cookie), 401, 'UNAUTHENTICATED');
    });

    it('rejects the session of a user disabled or archived after login', async () => {
      const student = await f.student(tenant);
      const { cookie } = await login(tenant, student);
      await f.setUserStatus(student, 'disabled');
      expectProblem(await client(t, tenant.host).get(SESSION, cookie), 401, 'UNAUTHENTICATED');

      const other = await f.student(tenant);
      const second = await login(tenant, other);
      await db
        .update(schema.students)
        .set({ archivedAt: t.clock.now() })
        .where(eq(schema.students.userId, other.id));
      expectProblem(
        await client(t, tenant.host).get(SESSION, second.cookie),
        401,
        'UNAUTHENTICATED',
      );
    });

    it('writes last_seen_at at most once a minute', async () => {
      const student = await f.student(tenant);
      const { cookie } = await login(tenant, student);
      const [start] = await sessionsOf(student);
      t.clock.advance(30_000);
      await client(t, tenant.host).get(SESSION, cookie);
      const [unchanged] = await sessionsOf(student);
      expect(unchanged?.lastSeenAt.getTime()).toBe(start?.lastSeenAt.getTime());
      t.clock.advance(30_000);
      await client(t, tenant.host).get(SESSION, cookie);
      const [touched] = await sessionsOf(student);
      expect(touched?.lastSeenAt.getTime()).toBe(t.clock.nowMs());
    });
  });

  describe('logout', () => {
    it('revokes the session, audits it and clears both cookie variants', async () => {
      const student = await f.student(tenant);
      const { cookie } = await login(tenant, student);
      const res = await client(t, tenant.host).post(LOGOUT, {}, cookie);
      expect(res.status).toBe(204);
      expect(res.text).toBe('');
      expect(res.headers['cache-control']).toBe('no-store');
      expect(res.headers['set-cookie']).toEqual(CLEARED);
      const [row] = await sessionsOf(student);
      expect(row?.revokedReason).toBe('logout');
      expectProblem(await client(t, tenant.host).get(SESSION, cookie), 401, 'UNAUTHENTICATED');
      const audits = (await f.audits(tenant, 'auth.logout')).filter(
        (a) => a.actorId === student.id,
      );
      expect(audits).toHaveLength(1);
      expect(audits[0]?.entityId).toBe(row?.id);
    });

    it('is 204 and clears cookies even without a session (empty body or {})', async () => {
      const bare = await client(t, tenant.host).post(LOGOUT);
      expect(bare.status).toBe(204);
      expect(bare.headers['set-cookie']).toEqual(CLEARED);
      const junk = await client(t, tenant.host).post(LOGOUT, {}, 'remix_session=junk');
      expect(junk.status).toBe(204);
    });
  });

  describe('tenant status on existing sessions (TEN-06)', () => {
    it('suspension locks students out at once; billing-only staff keep session, refresh, logout', async () => {
      const inst = await f.tenant('active');
      const student = await f.student(inst);
      const staff = await f.staff(inst, ['teacher']);
      const s = await login(inst, student);
      const st = await login(inst, staff, 'staff');

      await f.setTenantStatus(inst, 'suspended');
      t.tenantCache.clear(); // the 60 s host cache would otherwise delay it

      expectProblem(await client(t, inst.host).get(CLASSES, s.cookie), 403, 'TENANT_UNAVAILABLE');
      expectProblem(await client(t, inst.host).get(SESSION, s.cookie), 401, 'UNAUTHENTICATED');
      expectProblem(await client(t, inst.host).post(REFRESH, {}, s.cookie), 401, 'UNAUTHENTICATED');

      expect((await client(t, inst.host).get(SESSION, st.cookie)).status).toBe(200);
      t.clock.advance(15 * MIN);
      const refreshed = await client(t, inst.host).post(REFRESH, {}, st.cookie);
      expect(refreshed.status).toBe(200);
      const staffCookie = `remix_session=${cookieValue(setCookies(refreshed).get('remix_session'))}`;
      // Everything beyond session housekeeping is unavailable for billing-only staff.
      expectProblem(
        await client(t, inst.host).get(CLASSES, staffCookie),
        403,
        'TENANT_UNAVAILABLE',
      );
      expect((await client(t, inst.host).post(LOGOUT, {}, staffCookie)).status).toBe(204);
      expect((await client(t, inst.host).post(LOGOUT, {}, s.cookie)).status).toBe(204);

      // Public tenant info is served for any status.
      const info = await client(t, inst.host).get('/api/v1/tenant');
      expect(info.status).toBe(200);
      expect(info.body.status).toBe('suspended');
    });

    it('cancellation: staff sessions end too; logout still works', async () => {
      const inst = await f.tenant('active');
      const staff = await f.staff(inst, ['teacher']);
      const st = await login(inst, staff, 'staff');
      await f.setTenantStatus(inst, 'cancelled');
      t.tenantCache.clear();
      expectProblem(await client(t, inst.host).get(SESSION, st.cookie), 401, 'UNAUTHENTICATED');
      const out = await client(t, inst.host).post(LOGOUT, {}, st.cookie);
      expect(out.status).toBe(204);
      const [row] = await f.sessionsOf(staff);
      expect(row?.revokedReason).toBe('logout');
    });
  });
});
