import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { schema, type Db } from '@remix/db';
import {
  deviceLimitChallengeSchema,
  devicesResponseSchema,
  sessionResponseSchema,
} from '@remix/types/api';
import { expectProblem } from '../fixtures/problem';
import { jar, lastCode, loginStudent, only, P, smsTo } from './support/auth-helpers';
import {
  client,
  createDbTestApp,
  Factory,
  ownerDb,
  PASSWORD,
  type DbTestApp,
  type TenantFixture,
  type UserFixture,
} from './support/db-app';

const CHROME_ANDROID =
  'Mozilla/5.0 (Linux; Android 14; SM-A145F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36';

describe('device limit, "Me" and staff device actions (AUTH-03/04/08) against Postgres', () => {
  let t: DbTestApp;
  let db: Db;
  let f: Factory;
  let tenant: TenantFixture;
  let other: TenantFixture;

  beforeAll(async () => {
    t = await createDbTestApp();
    db = ownerDb();
    f = new Factory(db);
    tenant = await f.tenant('active');
    other = await f.tenant('active');
  });
  afterAll(async () => {
    await t.close();
    await db.$client.end();
  });

  /** A student signed in on two separate browsers (device cookies kept apart). */
  async function onTwoDevices(student: UserFixture) {
    const a = await loginStudent(t, tenant.host, student.phone).set('User-Agent', CHROME_ANDROID);
    const b = await loginStudent(t, tenant.host, student.phone);
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    return { a: jar(a), b: jar(b) };
  }

  describe('AUTH-03 — two-device limit', () => {
    it('a third device gets 403 DEVICE_LIMIT with a challenge, and no session', async () => {
      const student = await f.student(tenant);
      await onTwoDevices(student);
      const before = await f.sessionsOf(student);

      const third = await loginStudent(t, tenant.host, student.phone);
      const problem = expectProblem(third, 403, 'DEVICE_LIMIT');
      const challenge = deviceLimitChallengeSchema.strict().parse(problem.challenge);
      expect(challenge.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(challenge.devices).toHaveLength(2);
      expect(challenge.devices.map((d) => d.label)).toContain('Chrome on Android');
      expect(challenge.expiresAt).toBe(new Date(t.clock.nowMs() + 5 * 60_000).toISOString());
      expect(third.headers['set-cookie']).toBeUndefined();
      expect(await f.sessionsOf(student)).toHaveLength(before.length);
      expect(await f.devicesOf(student)).toHaveLength(2);
    });

    it('a device that is already signed in can always sign in again', async () => {
      const student = await f.student(tenant);
      const { a } = await onTwoDevices(student);
      const again = await loginStudent(t, tenant.host, student.phone, only(a, 'remix_device'));
      expect(again.status).toBe(200);
    });

    it('resolveDeviceLimit signs the chosen device out and finishes the login — once', async () => {
      const student = await f.student(tenant);
      const { a, b } = await onTwoDevices(student);
      const third = await loginStudent(t, tenant.host, student.phone);
      const challenge = deviceLimitChallengeSchema.parse(third.body.challenge);
      const devices = await f.devicesOf(student);
      const victim = devices.find((d) => d.label === 'Chrome on Android');
      if (!victim) throw new Error('device missing');

      const res = await client(t, tenant.host).post(P.deviceLimit, {
        token: challenge.token,
        signOutDeviceId: victim.id,
      });
      expect(res.status).toBe(200);
      expect(sessionResponseSchema.parse(res.body).user.id).toBe(student.id);
      const cookies = jar(res);
      expect(cookies).toMatch(/remix_session=/);
      expect(cookies).toMatch(/remix_device=/);

      expect((await client(t, tenant.host).get(P.session, a)).status).toBe(401);
      expect((await client(t, tenant.host).get(P.session, b)).status).toBe(200);
      expect((await client(t, tenant.host).get(P.session, cookies)).status).toBe(200);

      const [signedOut] = await db
        .select()
        .from(schema.devices)
        .where(eq(schema.devices.id, victim.id));
      expect(signedOut?.signedOutAt).not.toBeNull();
      expect(signedOut?.signedOutBy).toBe(student.id);
      const audit = (await f.audits(tenant, 'auth.device.signed_out')).find(
        (r) => r.entityId === victim.id,
      );
      expect(audit?.after).toMatchObject({ reason: 'device_limit' });

      const reuse = await client(t, tenant.host).post(P.deviceLimit, {
        token: challenge.token,
        signOutDeviceId: devices.find((d) => d.id !== victim.id)?.id,
      });
      expectProblem(reuse, 400, 'CODE_INVALID');
    });

    it('the ticket is spent by exactly one of several concurrent requests', async () => {
      const student = await f.student(tenant);
      await onTwoDevices(student);
      const third = await loginStudent(t, tenant.host, student.phone);
      const { token } = deviceLimitChallengeSchema.parse(third.body.challenge);
      const [d1, d2] = await f.devicesOf(student);
      const results = await Promise.all(
        [d1, d2, d1, d2].map((d) =>
          client(t, tenant.host).post(P.deviceLimit, { token, signOutDeviceId: d?.id }),
        ),
      );
      expect(results.filter((r) => r.status === 200)).toHaveLength(1);
      for (const r of results.filter((x) => x.status !== 200)) {
        expect(r.body.code).toBe('CODE_INVALID');
      }
      const active = (await f.devicesOf(student)).filter((d) => d.signedOutAt === null);
      expect(active).toHaveLength(2);
    });

    it('rejects a device that is not one of the student’s, an expired ticket and another institute', async () => {
      const student = await f.student(tenant);
      await onTwoDevices(student);
      const someoneElse = await f.student(tenant);
      await loginStudent(t, tenant.host, someoneElse.phone);
      const [foreign] = await f.devicesOf(someoneElse);

      const third = await loginStudent(t, tenant.host, student.phone);
      const { token } = deviceLimitChallengeSchema.parse(third.body.challenge);
      const [mine] = await f.devicesOf(student);

      expectProblem(
        await client(t, tenant.host).post(P.deviceLimit, { token, signOutDeviceId: foreign?.id }),
        400,
        'VALIDATION_FAILED',
      );
      expectProblem(
        await client(t, other.host).post(P.deviceLimit, { token, signOutDeviceId: mine?.id }),
        400,
        'CODE_INVALID',
      );
      t.clock.advance(5 * 60_000 + 1000);
      expectProblem(
        await client(t, tenant.host).post(P.deviceLimit, { token, signOutDeviceId: mine?.id }),
        400,
        'CODE_INVALID',
      );
    });
  });

  describe('AUTH-04 — Me', () => {
    it('lists active devices with the current one marked, and the limit', async () => {
      const student = await f.student(tenant);
      const { a } = await onTwoDevices(student);
      const res = await client(t, tenant.host).get(P.meDevices, a);
      expect(res.status).toBe(200);
      const body = devicesResponseSchema.strict().parse(res.body);
      expect(body.limit).toBe(2);
      expect(body.items).toHaveLength(2);
      expect(body.items.filter((d) => d.current)).toHaveLength(1);
      expect(body.items.find((d) => d.current)?.label).toBe('Chrome on Android');

      const staff = await f.staff(tenant, ['teacher']);
      const staffLogin = await client(t, tenant.host).post(P.staffLogin, {
        identifier: staff.email,
        password: PASSWORD,
      });
      const staffDevices = await client(t, tenant.host).get(P.meDevices, jar(staffLogin));
      expect(staffDevices.body.limit).toBeNull();
    });

    it('signs out another own device (its session dies) or the current one (cookie cleared)', async () => {
      const student = await f.student(tenant);
      const { a, b } = await onTwoDevices(student);
      const list = devicesResponseSchema.parse(
        (await client(t, tenant.host).get(P.meDevices, a)).body,
      );
      const otherDevice = list.items.find((d) => !d.current);
      const current = list.items.find((d) => d.current);

      const res = await client(t, tenant.host).del(`${P.meDevices}/${otherDevice?.id}`, a);
      expect(res.status).toBe(204);
      expect(res.headers['set-cookie']).toBeUndefined();
      expect((await client(t, tenant.host).get(P.session, b)).status).toBe(401);
      expect((await client(t, tenant.host).get(P.session, a)).status).toBe(200);

      const self = await client(t, tenant.host).del(`${P.meDevices}/${current?.id}`, a);
      expect(self.status).toBe(204);
      expect(String(self.headers['set-cookie'])).toMatch(/remix_session=; Max-Age=0/);
      expect((await client(t, tenant.host).get(P.session, a)).status).toBe(401);
    });

    it('cannot touch another user’s device (404), and a malformed id is 400', async () => {
      const student = await f.student(tenant);
      const mine = jar(await loginStudent(t, tenant.host, student.phone));
      const victim = await f.student(tenant);
      const theirs = jar(await loginStudent(t, tenant.host, victim.phone));
      const [device] = await f.devicesOf(victim);
      expectProblem(
        await client(t, tenant.host).del(`${P.meDevices}/${device?.id}`, mine),
        404,
        'NOT_FOUND',
      );
      expect((await client(t, tenant.host).get(P.session, theirs)).status).toBe(200);
      expectProblem(
        await client(t, tenant.host).del(`${P.meDevices}/not-a-uuid`, mine),
        400,
        'VALIDATION_FAILED',
      );
      expectProblem(await client(t, tenant.host).get(P.meDevices), 401, 'UNAUTHENTICATED');
    });

    it('changes the password: wrong current → 400; right → all sessions revoked, this device continues', async () => {
      const student = await f.student(tenant);
      const { a, b } = await onTwoDevices(student);
      expectProblem(
        await client(t, tenant.host).post(
          P.mePassword,
          { currentPassword: 'nope', newPassword: 'another long passphrase' },
          a,
        ),
        400,
        'INVALID_CREDENTIALS',
      );
      expectProblem(
        await client(t, tenant.host).post(
          P.mePassword,
          { currentPassword: PASSWORD, newPassword: 'password123' },
          a,
        ),
        400,
        'VALIDATION_FAILED',
      );
      const res = await client(t, tenant.host).post(
        P.mePassword,
        { currentPassword: PASSWORD, newPassword: 'another long passphrase' },
        a,
      );
      expect(res.status).toBe(204);
      const fresh = jar(res, a);
      expect(fresh).not.toBe(a);
      expect((await client(t, tenant.host).get(P.session, a)).status).toBe(401);
      expect((await client(t, tenant.host).get(P.session, b)).status).toBe(401);
      expect((await client(t, tenant.host).get(P.session, fresh)).status).toBe(200);
      expect(
        (
          await loginStudent(
            t,
            tenant.host,
            student.phone,
            only(a, 'remix_device'),
            'another long passphrase',
          )
        ).status,
      ).toBe(200);
      const [audit] = (await f.audits(tenant, 'auth.password.changed')).filter(
        (r) => r.entityId === student.id,
      );
      expect(audit?.after).toMatchObject({ sessionsRevoked: 2 });
    });

    it('updates the language', async () => {
      const student = await f.student(tenant);
      const cookies = jar(await loginStudent(t, tenant.host, student.phone));
      expect((await client(t, tenant.host).patch(P.me, { locale: 'si' }, cookies)).status).toBe(
        204,
      );
      const session = await client(t, tenant.host).get(P.session, cookies);
      expect(session.body.user.locale).toBe('si');
      expectProblem(
        await client(t, tenant.host).patch(P.me, { locale: 'fr' }, cookies),
        400,
        'VALIDATION_FAILED',
      );
    });
  });

  describe('AUTH-08 — staff sign out a student’s device and reset the password', () => {
    it('owner/admin pass two-step and may act; teachers, cashiers and students may not', async () => {
      const student = await f.student(tenant);
      const { a, b } = await onTwoDevices(student);
      const [device] = (await f.devicesOf(student)).filter((d) => d.label === 'Chrome on Android');
      const path = `/api/v1/admin/students/${student.id}/devices/${device?.id}`;

      for (const role of ['teacher', 'cashier', 'gatekeeper'] as const) {
        const { cookies } = await signInStaff([role]);
        expectProblem(await client(t, tenant.host).del(path, cookies), 403, 'FORBIDDEN');
      }
      expectProblem(await client(t, tenant.host).del(path, b), 403, 'FORBIDDEN');

      const owner = await signInOwner();
      const ok = await client(t, tenant.host).del(path, owner.cookies);
      expect(ok.status).toBe(204);
      expect((await client(t, tenant.host).get(P.session, a)).status).toBe(401);
      expect((await client(t, tenant.host).get(P.session, b)).status).toBe(200);
      const audit = (await f.audits(tenant, 'auth.device.signed_out')).find(
        (r) => r.entityId === device?.id,
      );
      expect(audit?.actorId).toBe(owner.id);
      expect(audit?.after).toMatchObject({ reason: 'staff', userId: student.id });

      expectProblem(await client(t, tenant.host).del(path, owner.cookies), 404, 'NOT_FOUND');
    });

    it('another institute’s student or device is 404', async () => {
      const foreign = await f.student(other);
      await loginStudent(t, other.host, foreign.phone);
      const [device] = await f.devicesOf(foreign);
      const owner = await signInOwner();
      expectProblem(
        await client(t, tenant.host).del(
          `/api/v1/admin/students/${foreign.id}/devices/${device?.id}`,
          owner.cookies,
        ),
        404,
        'NOT_FOUND',
      );
      expectProblem(
        await client(t, tenant.host).post(
          `/api/v1/admin/students/${foreign.id}/password-reset`,
          {},
          owner.cookies,
        ),
        404,
        'NOT_FOUND',
      );
      expect((await f.devicesOf(foreign))[0]?.signedOutAt).toBeNull();
    });

    it('reset: the old password stops working, sessions end, and a code is texted', async () => {
      const student = await f.student(tenant);
      const { a } = await onTwoDevices(student);
      const owner = await signInOwner();
      const res = await client(t, tenant.host).post(
        `/api/v1/admin/students/${student.id}/password-reset`,
        {},
        owner.cookies,
      );
      expect(res.status).toBe(204);
      expect((await client(t, tenant.host).get(P.session, a)).status).toBe(401);
      expectProblem(await loginStudent(t, tenant.host, student.phone), 401, 'INVALID_CREDENTIALS');
      const code = await lastCode(t, student.phone);
      const verify = await client(t, tenant.host).post(P.otpVerify, {
        phone: student.phone,
        purpose: 'password_reset',
        code,
      });
      expect(verify.status).toBe(200);
      const [audit] = (await f.audits(tenant, 'auth.password.reset_by_staff')).filter(
        (r) => r.entityId === student.id,
      );
      expect(audit?.actorId).toBe(owner.id);

      // Straight away again: the phone just got a code → 429 for staff (not silent).
      expectProblem(
        await client(t, tenant.host).post(
          `/api/v1/admin/students/${student.id}/password-reset`,
          {},
          owner.cookies,
        ),
        429,
        'RATE_LIMITED',
      );
    });

    const signInOwner = () => signInStaff(['owner']);

    /** Staff signed in, through two-step when the role needs it (code from the SMS mock). */
    async function signInStaff(roles: Parameters<Factory['staff']>[1]) {
      const owner = await f.staff(tenant, roles);
      const login = await client(t, tenant.host).post(P.staffLogin, {
        identifier: owner.email,
        password: PASSWORD,
      });
      if (login.status === 200) return { id: owner.id, cookies: jar(login) };
      expect(login.status).toBe(401);
      const code = await lastCode(t, owner.phone);
      const verify = await client(t, tenant.host).post(P.twoStep, {
        token: login.body.challenge.token,
        code,
      });
      expect(verify.status).toBe(200);
      await smsTo(t, owner.phone);
      return { id: owner.id, cookies: jar(verify) };
    }
  });
});
