import { eq } from 'drizzle-orm';
import request from 'supertest';
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
  START,
  type DbTestApp,
  type TenantFixture,
} from './support/db-app';

const STUDENT_LOGIN = '/api/v1/auth/student/login';
const STAFF_LOGIN = '/api/v1/auth/staff/login';
const SESSION = '/api/v1/auth/session';
const ANDROID_CHROME =
  'Mozilla/5.0 (Linux; Android 14; SM-A145F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36';

describe('login (AUTH-01, AUTH-05) against Postgres', () => {
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

  describe('student login', () => {
    it('signs in with a phone in any local format and sets exact dev cookies', async () => {
      const student = await f.student(tenant, { name: 'Nimali Perera' });
      const local = `0${student.phone.slice(3, 5)} ${student.phone.slice(5, 8)} ${student.phone.slice(8)}`;
      const res = await client(t, tenant.host)
        .post(STUDENT_LOGIN, { phone: local, password: PASSWORD })
        .set('User-Agent', ANDROID_CHROME);

      expect(res.status).toBe(200);
      expect(res.headers['cache-control']).toBe('no-store');
      const body = sessionResponseSchema.strict().parse(res.body);
      expect(body).toEqual({
        user: {
          id: student.id,
          tenantId: tenant.id,
          kind: 'student',
          displayName: 'Nimali Perera',
          roles: [],
          locale: 'en',
        },
        expiresAt: '2026-10-15T16:30:00.000Z', // 12 h, absolute
        impersonated: false,
      });

      const cookies = setCookies(res);
      expect([...cookies.keys()].sort()).toEqual(['remix_device', 'remix_session']);
      const session = cookies.get('remix_session') ?? '';
      expect(session).toMatch(
        /^remix_session=1792038600\.[A-Za-z0-9_-]{43}; Path=\/; HttpOnly; SameSite=Lax$/,
      );
      expect(cookies.get('remix_device')).toMatch(
        /^remix_device=[A-Za-z0-9_-]{43}; Max-Age=34560000; Path=\/; HttpOnly; SameSite=Lax$/,
      );
      expect(res.text).not.toContain(cookieValue(session));

      // Stored hashed only; the device is labelled from the User-Agent.
      const [row] = await f.sessionsOf(student);
      expect(row?.tokenHash).toMatch(/^[0-9a-f]{64}$/);
      expect(row?.tokenHash).not.toContain(cookieValue(session).split('.')[1]);
      expect(row?.expiresAt.toISOString()).toBe('2026-10-15T16:30:00.000Z');
      const [device] = await f.devicesOf(student);
      expect(device?.label).toBe('Chrome on Android');
      expect(device?.tokenHash).not.toBe(cookieValue(cookies.get('remix_device')));

      const me = await client(t, tenant.host).get(SESSION, `remix_session=${cookieValue(session)}`);
      expect(me.status).toBe(200);
      expect(me.body.user.id).toBe(student.id);
    });

    it('"stay signed in" gives a 30-day absolute session and a matching Max-Age', async () => {
      const student = await f.student(tenant);
      const res = await client(t, tenant.host).post(STUDENT_LOGIN, {
        phone: student.phone,
        password: PASSWORD,
        staySignedIn: true,
      });
      expect(res.status).toBe(200);
      expect(res.body.expiresAt).toBe('2026-11-14T04:30:00.000Z');
      expect(setCookies(res).get('remix_session')).toMatch(
        /^remix_session=[^;]+; Max-Age=2592000; Path=\/; HttpOnly; SameSite=Lax$/,
      );
    });

    it('wrong password and unknown phone give the identical 401', async () => {
      const student = await f.student(tenant);
      const wrong = await client(t, tenant.host).post(STUDENT_LOGIN, {
        phone: student.phone,
        password: 'not the password',
      });
      const unknown = await client(t, tenant.host).post(STUDENT_LOGIN, {
        phone: '+94769999999',
        password: 'not the password',
      });
      const a = expectProblem(wrong, 401, 'INVALID_CREDENTIALS');
      const b = expectProblem(unknown, 401, 'INVALID_CREDENTIALS');
      expect({ ...a, requestId: undefined }).toEqual({ ...b, requestId: undefined });
      expect(setCookies(wrong).size).toBe(0);
      expect(setCookies(unknown).size).toBe(0);
    });

    it('ACCOUNT_DISABLED only after a correct password', async () => {
      const student = await f.student(tenant, { status: 'disabled' });
      const wrong = await client(t, tenant.host).post(STUDENT_LOGIN, {
        phone: student.phone,
        password: 'wrong password',
      });
      expectProblem(wrong, 401, 'INVALID_CREDENTIALS');
      const right = await client(t, tenant.host).post(STUDENT_LOGIN, {
        phone: student.phone,
        password: PASSWORD,
      });
      expectProblem(right, 403, 'ACCOUNT_DISABLED');
      expect(setCookies(right).size).toBe(0);
    });

    it('blocks archived students', async () => {
      const student = await f.student(tenant, { archived: true });
      const res = await client(t, tenant.host).post(STUDENT_LOGIN, {
        phone: student.phone,
        password: PASSWORD,
      });
      expectProblem(res, 403, 'ACCOUNT_DISABLED');
      expect(await f.sessionsOf(student)).toHaveLength(0);
    });

    it('a staff member cannot sign in at the student endpoint', async () => {
      const staff = await f.staff(tenant, ['owner']);
      const res = await client(t, tenant.host).post(STUDENT_LOGIN, {
        phone: staff.phone,
        password: PASSWORD,
      });
      expectProblem(res, 401, 'INVALID_CREDENTIALS');
    });

    it('issues a fresh token on every login, reuses the device and replaces the old session', async () => {
      const student = await f.student(tenant);
      const first = await client(t, tenant.host).post(STUDENT_LOGIN, {
        phone: student.phone,
        password: PASSWORD,
      });
      const c1 = setCookies(first);
      const jar = `remix_session=${cookieValue(c1.get('remix_session'))}; remix_device=${cookieValue(c1.get('remix_device'))}`;
      const second = await client(t, tenant.host).post(
        STUDENT_LOGIN,
        { phone: student.phone, password: PASSWORD },
        jar,
      );
      const c2 = setCookies(second);
      expect(cookieValue(c2.get('remix_session'))).not.toBe(cookieValue(c1.get('remix_session')));
      expect(cookieValue(c2.get('remix_device'))).toBe(cookieValue(c1.get('remix_device')));
      expect(await f.devicesOf(student)).toHaveLength(1);

      const sessions = await f.sessionsOf(student);
      expect(sessions).toHaveLength(2);
      expect(sessions[0]?.revokedReason).toBe('replaced');
      expect(sessions[1]?.revokedAt).toBeNull();
      expect(sessions[0]?.deviceId).toBe(sessions[1]?.deviceId);

      // A new browser (no device cookie) is a new device; 2-device limit is AUTH-03 (later).
      await client(t, tenant.host).post(STUDENT_LOGIN, {
        phone: student.phone,
        password: PASSWORD,
      });
      expect(await f.devicesOf(student)).toHaveLength(2);
    });

    it('validates strictly: unknown fields and bad phones are 400', async () => {
      const extra = await client(t, tenant.host).post(STUDENT_LOGIN, {
        phone: '0771234567',
        password: PASSWORD,
        tenantId: tenant.id,
      });
      expectProblem(extra, 400, 'VALIDATION_FAILED');
      const landline = await client(t, tenant.host).post(STUDENT_LOGIN, {
        phone: '0112345678',
        password: PASSWORD,
      });
      expectProblem(landline, 400, 'VALIDATION_FAILED');
    });
  });

  describe('staff login', () => {
    it('signs in by email (any case) or phone and returns roles from staff_roles', async () => {
      // Teacher + gatekeeper: roles without the SMS two-step (that is two-step-invite.int).
      const staff = await f.staff(tenant, ['gatekeeper', 'teacher'], {
        email: 'kamal.owner@example.test',
        name: 'Kamal Jayasinghe',
      });
      const byEmail = await client(t, tenant.host).post(STAFF_LOGIN, {
        identifier: '  Kamal.Owner@Example.TEST ',
        password: PASSWORD,
      });
      expect(byEmail.status).toBe(200);
      expect(byEmail.body.user).toEqual({
        id: staff.id,
        tenantId: tenant.id,
        kind: 'staff',
        displayName: 'Kamal Jayasinghe',
        roles: ['teacher', 'gatekeeper'],
        locale: 'en',
      });
      expect(byEmail.body.impersonated).toBe(false);

      const byPhone = await client(t, tenant.host).post(STAFF_LOGIN, {
        identifier: staff.phone,
        password: PASSWORD,
      });
      expect(byPhone.status).toBe(200);
      const cookie = `remix_session=${cookieValue(setCookies(byPhone).get('remix_session'))}`;
      const me = await client(t, tenant.host).get(SESSION, cookie);
      expect(me.body.user.roles).toEqual(['teacher', 'gatekeeper']);
    });

    it('a student cannot sign in at the staff endpoint; garbage identifiers are generic', async () => {
      const student = await f.student(tenant);
      const asStaff = await client(t, tenant.host).post(STAFF_LOGIN, {
        identifier: student.phone,
        password: PASSWORD,
      });
      expectProblem(asStaff, 401, 'INVALID_CREDENTIALS');
      const garbage = await client(t, tenant.host).post(STAFF_LOGIN, {
        identifier: 'not-an-identifier',
        password: PASSWORD,
      });
      expectProblem(garbage, 401, 'INVALID_CREDENTIALS');
    });

    it('a disabled staff member gets ACCOUNT_DISABLED after the right password', async () => {
      const staff = await f.staff(tenant, ['cashier'], { status: 'disabled' });
      const res = await client(t, tenant.host).post(STAFF_LOGIN, {
        identifier: staff.email ?? '',
        password: PASSWORD,
      });
      expectProblem(res, 403, 'ACCOUNT_DISABLED');
    });
  });

  describe('secure cookies (production settings)', () => {
    let secure: DbTestApp;
    beforeAll(async () => {
      secure = await createDbTestApp({ COOKIE_SECURE: 'true' });
    });
    afterAll(() => secure.close());

    it('uses __Host- names with Secure, HttpOnly, SameSite=Lax, Path=/ and no Domain', async () => {
      const student = await f.student(tenant);
      const res = await client(secure, tenant.host).post(STUDENT_LOGIN, {
        phone: student.phone,
        password: PASSWORD,
        staySignedIn: true,
      });
      expect(res.status).toBe(200);
      const cookies = setCookies(res);
      expect([...cookies.keys()].sort()).toEqual(['__Host-remix_device', '__Host-remix_session']);
      expect(cookies.get('__Host-remix_session')).toMatch(
        /^__Host-remix_session=\d+\.[A-Za-z0-9_-]{43}; Max-Age=2592000; Path=\/; HttpOnly; Secure; SameSite=Lax$/,
      );
      expect(cookies.get('__Host-remix_device')).toMatch(
        /^__Host-remix_device=[A-Za-z0-9_-]{43}; Max-Age=34560000; Path=\/; HttpOnly; Secure; SameSite=Lax$/,
      );

      const token = cookieValue(cookies.get('__Host-remix_session'));
      const ok = await client(secure, tenant.host).get(SESSION, `__Host-remix_session=${token}`);
      expect(ok.status).toBe(200);
      // With secure cookies the plain name is never read (a sibling sub-domain could plant it).
      const plain = await client(secure, tenant.host).get(SESSION, `remix_session=${token}`);
      expectProblem(plain, 401, 'UNAUTHENTICATED');
    });
  });

  describe('tenant status (TEN-06) and hosts (TEN-01)', () => {
    it.each([
      ['suspended', 403, 'TENANT_UNAVAILABLE', 200],
      ['cancelled', 403, 'TENANT_UNAVAILABLE', 403],
      ['trial', 200, null, 200],
      ['past_due', 200, null, 200],
    ] as const)(
      '%s tenant: student %i, staff %i',
      async (status, studentStatus, code, staffStatus) => {
        const other = await f.tenant(status);
        const student = await f.student(other);
        const staff = await f.staff(other, ['teacher']);
        const s = await client(t, other.host).post(STUDENT_LOGIN, {
          phone: student.phone,
          password: PASSWORD,
        });
        if (code) expectProblem(s, studentStatus, code);
        else expect(s.status).toBe(200);
        const st = await client(t, other.host).post(STAFF_LOGIN, {
          identifier: staff.phone,
          password: PASSWORD,
        });
        if (staffStatus === 200) expect(st.status).toBe(200);
        else expectProblem(st, staffStatus, 'TENANT_UNAVAILABLE');
      },
    );

    it('a status check runs before any credential work (even a wrong password)', async () => {
      const closed = await f.tenant('suspended');
      const res = await client(t, closed.host).post(STUDENT_LOGIN, {
        phone: '+94761111111',
        password: 'whatever',
      });
      expectProblem(res, 403, 'TENANT_UNAVAILABLE');
    });

    it('unknown, reserved and malformed hosts are 404 TENANT_NOT_FOUND', async () => {
      for (const host of ['nobody-here.remix.lk', 'www.remix.lk', 'a.b.remix.lk', 'remix.lk']) {
        const res = await client(t, host).post(STUDENT_LOGIN, {
          phone: '0771234567',
          password: PASSWORD,
        });
        expectProblem(res, 404, 'TENANT_NOT_FOUND');
      }
    });

    it('the same phone in two tenants is two accounts, each with its own password', async () => {
      const a = await f.tenant('active');
      const b = await f.tenant('active');
      const phone = '+94761234567';
      const otherHash = await import('@remix/db').then((m) => m.hashPassword('other tenant pw'));
      const inA = await f.student(a, { phone });
      const inB = await f.student(b, { phone, passwordHash: otherHash });

      const aOk = await client(t, a.host).post(STUDENT_LOGIN, { phone, password: PASSWORD });
      expect(aOk.body.user.id).toBe(inA.id);
      const bOk = await client(t, b.host).post(STUDENT_LOGIN, {
        phone,
        password: 'other tenant pw',
      });
      expect(bOk.body.user.id).toBe(inB.id);

      expectProblem(
        await client(t, a.host).post(STUDENT_LOGIN, { phone, password: 'other tenant pw' }),
        401,
        'INVALID_CREDENTIALS',
      );
      expectProblem(
        await client(t, b.host).post(STUDENT_LOGIN, { phone, password: PASSWORD }),
        401,
        'INVALID_CREDENTIALS',
      );
    });
  });

  describe('CSRF and rate limits', () => {
    it('rejects a cross-origin login (login CSRF)', async () => {
      const student = await f.student(tenant);
      const res = await request(t.server)
        .post(STUDENT_LOGIN)
        .set('Host', tenant.host)
        .set('Origin', 'https://evil.remix.lk')
        .set('Content-Type', 'application/json')
        .send(JSON.stringify({ phone: student.phone, password: PASSWORD }));
      expectProblem(res, 403, 'CSRF_REJECTED');
      const sibling = await request(t.server)
        .post(STUDENT_LOGIN)
        .set('Host', tenant.host)
        .set('Sec-Fetch-Site', 'same-site')
        .set('Content-Type', 'application/json')
        .send(JSON.stringify({ phone: student.phone, password: PASSWORD }));
      expectProblem(sibling, 403, 'CSRF_REJECTED');
      const same = await request(t.server)
        .post(STUDENT_LOGIN)
        .set('Host', tenant.host)
        .set('Origin', `http://${tenant.host}`)
        .set('Sec-Fetch-Site', 'same-origin')
        .set('Content-Type', 'application/json')
        .send(JSON.stringify({ phone: student.phone, password: PASSWORD }));
      expect(same.status).toBe(200);
    });

    it('5 attempts per minute per phone (any format), then 429 with Retry-After', async () => {
      const limited = await f.tenant('active');
      const student = await f.student(limited);
      const ip = '198.51.100.7';
      const attempt = (phone: string) =>
        client(t, limited.host)
          .post(STUDENT_LOGIN, { phone, password: 'wrong password' })
          .set('X-Forwarded-For', ip);
      const local = `0${student.phone.slice(3)}`;
      for (let i = 0; i < 5; i++) {
        expect((await attempt(i % 2 ? local : student.phone)).status).toBe(401);
      }
      const blocked = await attempt(student.phone);
      expectProblem(blocked, 429, 'RATE_LIMITED');
      expect(blocked.headers['retry-after']).toBe('60');
      // The staff endpoint shares the per-identifier budget.
      const viaStaff = await client(t, limited.host)
        .post(STAFF_LOGIN, { identifier: local, password: 'x' })
        .set('X-Forwarded-For', '198.51.100.8');
      expectProblem(viaStaff, 429, 'RATE_LIMITED');

      t.clock.advance(60_000);
      expect((await attempt(student.phone)).status).toBe(401);
    });

    it('counts padded and over-long identifiers against the same budget (S-01)', async () => {
      const limited = await f.tenant('active');
      const student = await f.student(limited);
      const local = `0${student.phone.slice(3)}`;
      const attempt = (phone: string) =>
        client(t, limited.host).post(STUDENT_LOGIN, { phone, password: 'wrong password' });
      // The schema trims before it checks the length, so this still reaches the real account.
      const variants = [
        student.phone,
        `  ${local}`,
        `${student.phone}${' '.repeat(260)}`,
        `${' '.repeat(300)}${local}`,
        `${local} `,
      ];
      for (const phone of variants) expect((await attempt(phone)).status).toBe(401);
      for (const phone of [student.phone, ...variants]) {
        expectProblem(await attempt(phone), 429, 'RATE_LIMITED');
      }
    });

    it('counts padded staff emails against one budget, shared with the clean value (S-01)', async () => {
      const limited = await f.tenant('active');
      const owner = await f.staff(limited, ['owner'], { email: 'Owner.Padded@Example.test' });
      const attempt = (identifier: string) =>
        client(t, limited.host).post(STAFF_LOGIN, { identifier, password: 'wrong password' });
      const email = owner.email ?? '';
      const variants = [
        email,
        email.toUpperCase(),
        `${email}${' '.repeat(260)}`,
        `${' '.repeat(255)}${email.toLowerCase()}`,
        ` ${email} `,
      ];
      for (const identifier of variants) expect((await attempt(identifier)).status).toBe(401);
      expectProblem(await attempt(email), 429, 'RATE_LIMITED');
      expectProblem(await attempt(`${email}${' '.repeat(260)}`), 429, 'RATE_LIMITED');
    });

    it('never skips the identifier rule for an unusable body: one shared bucket (S-01)', async () => {
      const limited = await f.tenant('active');
      const garbage = (n: number) =>
        client(t, limited.host).post(STAFF_LOGIN, {
          identifier: `${'x'.repeat(300)}${n}`,
          password: 'x',
        });
      // Validation rejects each one (400) — but each is counted, whatever its value.
      for (let i = 0; i < 5; i++) expect((await garbage(i)).status).toBe(400);
      expectProblem(await garbage(99), 429, 'RATE_LIMITED');
    });

    it('20 attempts per minute per client IP', async () => {
      const limited = await f.tenant('active');
      const ip = '198.51.100.9';
      for (let i = 0; i < 20; i++) {
        const res = await client(t, limited.host)
          .post(STUDENT_LOGIN, { phone: `+947600000${String(i).padStart(2, '0')}`, password: 'x' })
          .set('X-Forwarded-For', ip);
        expect(res.status).toBe(401);
      }
      const blocked = await client(t, limited.host)
        .post(STUDENT_LOGIN, { phone: '+94760000099', password: 'x' })
        .set('X-Forwarded-For', ip);
      expectProblem(blocked, 429, 'RATE_LIMITED');
      expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);
      // The limiter only ever holds hashed, tenant-prefixed keys.
      for (const key of t.limiter.keys()) {
        expect(key).toMatch(/^t:[0-9a-f-]{36}:(rl:login-(id|ip)|login-fail):[A-Za-z0-9_-]{32}$/);
        expect(key).not.toContain('198.51');
        expect(key).not.toContain('+947');
      }
    });
  });

  describe('audit trail and logs', () => {
    it('flags a login that still uses a temporary password (S-05), and only that one', async () => {
      const flagged = await f.tenant('active');
      const owner = await f.staff(flagged, ['teacher'], { email: 'temp.owner@example.test' });
      const colleague = await f.staff(flagged, ['gatekeeper']);
      await db
        .update(schema.tenantUsers)
        .set({ mustChangePassword: true })
        .where(eq(schema.tenantUsers.id, owner.id));

      const res = await client(t, flagged.host).post(STAFF_LOGIN, {
        identifier: 'temp.owner@example.test',
        password: PASSWORD,
      });
      expect(res.status).toBe(200); // still allowed until AUTH-07 enforces the change
      await client(t, flagged.host).post(STAFF_LOGIN, {
        identifier: colleague.phone,
        password: PASSWORD,
      });

      const rows = await f.audits(flagged, 'auth.login.temporary_password');
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        actorId: owner.id,
        actorKind: 'staff',
        entity: 'session',
        requestId: res.headers['x-request-id'],
      });
      const [session] = await f.sessionsOf(owner);
      expect(rows[0]?.entityId).toBe(session?.id);
      expect(JSON.stringify(rows)).not.toContain(PASSWORD);
      expect(JSON.stringify(rows)).not.toContain('temp.owner@example.test');
      // A failed attempt with the temporary password is not a "temporary password login".
      await client(t, flagged.host).post(STAFF_LOGIN, {
        identifier: 'temp.owner@example.test',
        password: 'wrong password',
      });
      expect(await f.audits(flagged, 'auth.login.temporary_password')).toHaveLength(1);
    });

    it('writes login success/failure rows with request id and IP, and no secrets', async () => {
      const audited = await f.tenant('active');
      const student = await f.student(audited);
      const ok = await client(t, audited.host)
        .post(STUDENT_LOGIN, { phone: student.phone, password: PASSWORD })
        .set('X-Forwarded-For', '203.0.113.5');
      const token = cookieValue(setCookies(ok).get('remix_session'));
      await client(t, audited.host).post(STUDENT_LOGIN, {
        phone: student.phone,
        password: 'a wrong password',
      });
      await client(t, audited.host).post(STUDENT_LOGIN, {
        phone: '+94765550000',
        password: 'a wrong password',
      });

      const rows = await f.audits(audited);
      const succeeded = rows.filter((r) => r.action === 'auth.login.succeeded');
      const failed = rows.filter((r) => r.action === 'auth.login.failed');
      expect(succeeded).toHaveLength(1);
      expect(succeeded[0]).toMatchObject({
        actorId: student.id,
        actorKind: 'student',
        entity: 'session',
        ip: '203.0.113.5',
        requestId: ok.headers['x-request-id'],
      });
      expect(failed.map((r) => [r.actorId, (r.after as { reason: string }).reason])).toEqual([
        [student.id, 'wrong_password'],
        [null, 'unknown_user'],
      ]);
      expect(failed.every((r) => r.requestId && r.ip)).toBe(true);

      const dump = JSON.stringify(rows);
      expect(dump).not.toContain(PASSWORD);
      expect(dump).not.toContain('a wrong password');
      expect(dump).not.toContain(student.phone);
      expect(dump).not.toContain('+94765550000');
      expect(dump).not.toContain(token);
      expect(dump).not.toContain(token.split('.')[1]);
      expect(dump).toContain(`+94*******${student.phone.slice(-2)}`);

      const logs = t.logs.text;
      expect(logs).not.toContain(PASSWORD);
      expect(logs).not.toContain(student.phone);
      expect(logs).not.toContain(token.split('.')[1]);
    });
  });

  it('uses the injected clock for the token prefix', () => {
    expect(Math.floor(START.getTime() / 1000)).toBe(1_792_038_600);
  });
});
