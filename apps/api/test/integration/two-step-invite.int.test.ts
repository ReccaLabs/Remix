import { createHash, randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { schema, type Db } from '@remix/db';
import {
  invitePreviewSchema,
  sessionResponseSchema,
  twoStepChallengeSchema,
} from '@remix/types/api';
import { createRequestContext, runWithContext } from '../../src/common/context/request-context';
import { AuthNotifications } from '../../src/modules/auth/auth-notifications';
import { expectProblem } from '../fixtures/problem';
import { jar, lastCode, only, P, smsTo, wrong } from './support/auth-helpers';
import {
  client,
  createDbTestApp,
  Factory,
  ownerDb,
  PASSWORD,
  setCookies,
  START,
  uniquePhone,
  type DbTestApp,
  type TenantFixture,
} from './support/db-app';

describe('staff two-step and invitations (AUTH-05/07) against Postgres', () => {
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

  const staffLogin = (identifier: string | null, cookies?: string, host = tenant.host) =>
    client(t, host).post(P.staffLogin, { identifier, password: PASSWORD }, cookies);

  describe('AUTH-05 — two-step', () => {
    it('owner, admin and cashier are challenged; teachers and gatekeepers are not', async () => {
      for (const role of ['owner', 'admin', 'cashier'] as const) {
        const staff = await f.staff(tenant, [role]);
        const res = await staffLogin(staff.email);
        const problem = expectProblem(res, 401, 'TWO_STEP_REQUIRED');
        const challenge = twoStepChallengeSchema.strict().parse(problem.challenge);
        expect(challenge.maskedPhone).toBe(
          `+94 ${staff.phone.slice(3, 5)} *** **${staff.phone.slice(-2)}`,
        );
        expect(challenge.resendAfterSeconds).toBe(45);
        expect(res.headers['set-cookie']).toBeUndefined();
        const [sms] = await smsTo(t, staff.phone);
        expect(sms?.text).toMatch(/^\d{6} is your .+ sign-in code\./);
      }
      for (const role of ['teacher', 'gatekeeper'] as const) {
        const staff = await f.staff(tenant, [role]);
        expect((await staffLogin(staff.email)).status).toBe(200);
      }
    });

    it('a second sign-in within 45 s is 429: no extra SMS', async () => {
      const owner = await f.staff(tenant, ['owner']);
      expect((await staffLogin(owner.email)).status).toBe(401);
      const again = await staffLogin(owner.email);
      expectProblem(again, 429, 'RATE_LIMITED');
      expect(await smsTo(t, owner.phone)).toHaveLength(1);
    });

    it('a wrong password never sends a code; a 2-step role without a mobile is refused', async () => {
      const owner = await f.staff(tenant, ['owner']);
      const res = await client(t, tenant.host).post(P.staffLogin, {
        identifier: owner.email,
        password: 'wrong password',
      });
      expectProblem(res, 401, 'INVALID_CREDENTIALS');
      expect(await smsTo(t, owner.phone)).toHaveLength(0);

      const noPhone = await f.staff(tenant, ['cashier'], { phone: null });
      expectProblem(await staffLogin(noPhone.email), 403, 'FORBIDDEN');
    });

    it('the right code signs in; trust sets a 30-day host-only cookie that skips the next 2-step', async () => {
      const owner = await f.staff(tenant, ['owner']);
      const login = await staffLogin(owner.email);
      const { token } = twoStepChallengeSchema.parse(login.body.challenge);
      const code = await lastCode(t, owner.phone);

      expectProblem(
        await client(t, tenant.host).post(P.twoStep, { token, code: wrong(code) }),
        400,
        'CODE_INVALID',
      );
      const ok = await client(t, tenant.host).post(P.twoStep, { token, code, trustDevice: true });
      expect(ok.status).toBe(200);
      expect(sessionResponseSchema.parse(ok.body).user.roles).toEqual(['owner']);
      const trust = setCookies(ok).get('remix_trust');
      expect(trust).toMatch(
        /^remix_trust=[A-Za-z0-9_-]{43}; Max-Age=2592000; Path=\/; HttpOnly; SameSite=Lax$/,
      );
      expect(ok.text).not.toContain(trust?.split(';')[0]?.split('=')[1] ?? 'x');
      const audits = await f.audits(tenant, 'auth.device.trusted');
      expect(audits.some((a) => a.actorId === owner.id)).toBe(true);

      // Single use.
      expectProblem(
        await client(t, tenant.host).post(P.twoStep, { token, code }),
        400,
        'CODE_INVALID',
      );

      // Trusted: the next sign-in on this computer skips the code.
      const cookies = jar(ok);
      expect((await staffLogin(owner.email, cookies)).status).toBe(200);
      // Without the trust cookie: challenged again (a new code may go out 45 s after the last).
      t.clock.advance(46_000);
      expect((await staffLogin(owner.email, only(cookies, 'remix_device'))).status).toBe(401);
      // Another user's trust cookie does not help.
      const admin = await f.staff(tenant, ['admin']);
      expect((await staffLogin(admin.email, only(cookies, 'remix_trust'))).status).toBe(401);
      // Trust ends after 30 days.
      t.clock.advance(30 * 24 * 3600_000 + 1000);
      expect((await staffLogin(owner.email, cookies)).status).toBe(401);
      t.clock.set(START);
    });

    it('a password change forgets every trusted computer', async () => {
      const owner = await f.staff(tenant, ['owner']);
      const login = await staffLogin(owner.email);
      const code = await lastCode(t, owner.phone);
      const ok = await client(t, tenant.host).post(P.twoStep, {
        token: login.body.challenge.token,
        code,
        trustDevice: true,
      });
      const cookies = jar(ok);
      const change = await client(t, tenant.host).post(
        P.mePassword,
        { currentPassword: PASSWORD, newPassword: 'a new staff passphrase' },
        cookies,
      );
      expect(change.status).toBe(204);
      t.clock.advance(46_000);
      const again = await client(t, tenant.host).post(
        P.staffLogin,
        { identifier: owner.email, password: 'a new staff passphrase' },
        jar(change, cookies),
      );
      expectProblem(again, 401, 'TWO_STEP_REQUIRED');
    });

    it('5 wrong codes burn the challenge; a token is useless on another institute', async () => {
      const owner = await f.staff(tenant, ['owner']);
      const login = await staffLogin(owner.email);
      const { token } = twoStepChallengeSchema.parse(login.body.challenge);
      const code = await lastCode(t, owner.phone);
      expectProblem(
        await client(t, other.host).post(P.twoStep, { token, code }),
        400,
        'CODE_INVALID',
      );
      for (let i = 0; i < 5; i += 1) {
        await client(t, tenant.host).post(P.twoStep, { token, code: wrong(code) });
      }
      expectProblem(
        await client(t, tenant.host).post(P.twoStep, { token, code }),
        400,
        'CODE_INVALID',
      );
    });

    it('resend: not before 45 s; then a new code replaces the old one', async () => {
      const owner = await f.staff(tenant, ['owner']);
      const login = await staffLogin(owner.email);
      const { token } = twoStepChallengeSchema.parse(login.body.challenge);
      const first = await lastCode(t, owner.phone);

      const early = await client(t, tenant.host).post(P.twoStepResend, { token });
      expectProblem(early, 429, 'RATE_LIMITED');
      expect(Number(early.headers['retry-after'])).toBeGreaterThan(0);

      t.clock.advance(46_000);
      const resent = await client(t, tenant.host).post(P.twoStepResend, { token });
      expect(resent.status).toBe(200);
      const challenge = twoStepChallengeSchema.strict().parse(resent.body);
      expect(challenge.token).toBe(token);
      const second = await lastCode(t, owner.phone);
      expect(await smsTo(t, owner.phone)).toHaveLength(2);
      if (first !== second) {
        expectProblem(
          await client(t, tenant.host).post(P.twoStep, { token, code: first }),
          400,
          'CODE_INVALID',
        );
      }
      expect((await client(t, tenant.host).post(P.twoStep, { token, code: second })).status).toBe(
        200,
      );
    });
  });

  describe('AUTH-07 — invitations', () => {
    async function invite(
      at: TenantFixture,
      opts: { role?: 'teacher' | 'cashier'; expiresInMs?: number; phone?: string } = {},
    ) {
      const owner = await f.staff(at, ['owner']);
      const token = randomBytes(32).toString('base64url');
      const phone = opts.phone ?? uniquePhone();
      const classId = await f.klass(at, { name: 'Physics', feeCents: 100_000 });
      const [row] = await db
        .insert(schema.staffInvites)
        .values({
          tenantId: at.id,
          displayName: 'Dilani Fernando',
          phone,
          role: opts.role ?? 'teacher',
          classScope: [classId],
          tokenHash: createHash('sha256').update(token).digest('hex'),
          invitedBy: owner.id,
          expiresAt: new Date(START.getTime() + (opts.expiresInMs ?? 72 * 3600_000)),
          createdAt: START,
        })
        .returning({ id: schema.staffInvites.id });
      if (!row) throw new Error('invite not created');
      return { id: row.id, token, phone, classId };
    }

    it('previews a valid invitation; unknown, expired and cross-tenant tokens are one 400', async () => {
      const inv = await invite(tenant);
      const res = await client(t, tenant.host).post(P.invitePreview, { token: inv.token });
      expect(res.status).toBe(200);
      expect(invitePreviewSchema.strict().parse(res.body)).toEqual({
        tenantName: expect.stringMatching(/^Test t-/) as string,
        displayName: 'Dilani Fernando',
        role: 'teacher',
        expiresAt: new Date(START.getTime() + 72 * 3600_000).toISOString(),
      });

      const unknown = expectProblem(
        await client(t, tenant.host).post(P.invitePreview, {
          token: randomBytes(32).toString('base64url'),
        }),
        400,
        'INVITE_INVALID',
      );
      const crossTenant = expectProblem(
        await client(t, other.host).post(P.invitePreview, { token: inv.token }),
        400,
        'INVITE_INVALID',
      );
      const old = await invite(tenant, { expiresInMs: 1000 });
      t.clock.advance(2000);
      const expired = expectProblem(
        await client(t, tenant.host).post(P.invitePreview, { token: old.token }),
        400,
        'INVITE_INVALID',
      );
      t.clock.set(START);
      const strip = (p: object) => ({ ...p, requestId: undefined });
      expect(strip(crossTenant)).toEqual(strip(unknown));
      expect(strip(expired)).toEqual(strip(unknown));
    });

    it('accepting creates the staff account with role and class scope and signs in — once', async () => {
      const inv = await invite(tenant);
      const res = await client(t, tenant.host).post(P.inviteAccept, {
        token: inv.token,
        newPassword: 'a teacher passphrase',
      });
      expect(res.status).toBe(200);
      const session = sessionResponseSchema.parse(res.body);
      expect(session.user).toMatchObject({
        kind: 'staff',
        roles: ['teacher'],
        displayName: 'Dilani Fernando',
      });
      expect((await client(t, tenant.host).get(P.session, jar(res))).status).toBe(200);

      const [role] = await db
        .select()
        .from(schema.staffRoles)
        .where(eq(schema.staffRoles.userId, session.user.id));
      expect(role?.classScope).toEqual([inv.classId]);
      const [row] = await db
        .select()
        .from(schema.staffInvites)
        .where(eq(schema.staffInvites.id, inv.id));
      expect(row?.acceptedUserId).toBe(session.user.id);
      expect(
        (await f.audits(tenant, 'staff.invite.accepted')).some((a) => a.entityId === inv.id),
      ).toBe(true);

      expectProblem(
        await client(t, tenant.host).post(P.inviteAccept, {
          token: inv.token,
          newPassword: 'a teacher passphrase',
        }),
        400,
        'INVITE_INVALID',
      );
      // The new teacher signs in with the phone and the chosen password.
      expect(
        (
          await client(t, tenant.host).post(P.staffLogin, {
            identifier: inv.phone,
            password: 'a teacher passphrase',
          })
        ).status,
      ).toBe(200);
    });

    it('concurrent accepts create exactly one account', async () => {
      const inv = await invite(tenant);
      const results = await Promise.all(
        Array.from({ length: 4 }, () =>
          client(t, tenant.host).post(P.inviteAccept, {
            token: inv.token,
            newPassword: 'a teacher passphrase',
          }),
        ),
      );
      expect(results.filter((r) => r.status === 200)).toHaveLength(1);
      const users = await db
        .select()
        .from(schema.tenantUsers)
        .where(eq(schema.tenantUsers.phone, inv.phone));
      expect(users).toHaveLength(1);
    });

    it('a phone that already has an account is a 409 and the invitation stays open', async () => {
      const existing = await f.student(tenant);
      const inv = await invite(tenant, { phone: existing.phone });
      expectProblem(
        await client(t, tenant.host).post(P.inviteAccept, {
          token: inv.token,
          newPassword: 'a teacher passphrase',
        }),
        409,
        'CONFLICT',
      );
      expect(
        (await client(t, tenant.host).post(P.invitePreview, { token: inv.token })).status,
      ).toBe(200);
    });

    it('hooks: onStaffInvited texts the fragment link; onStudentInvited texts a first-password code', async () => {
      const notifications = t.app.get(AuthNotifications);
      const inv = await invite(tenant);
      const ctx = createRequestContext({
        requestId: 'test',
        host: tenant.host,
        protocol: 'https',
        origin: `https://${tenant.host}`,
        clientIp: '198.51.100.7',
      });
      await runWithContext(ctx, () =>
        notifications.onStaffInvited(tenant.id, { id: inv.id, phone: inv.phone, token: inv.token }),
      );
      const [sms] = await smsTo(t, inv.phone);
      expect(sms?.text).toContain(`https://${tenant.host}/admin/invite#${inv.token}`);

      const student = await f.student(tenant, { status: 'invited' });
      expect(await notifications.onStudentInvited(tenant.id, student.id)).toBe(true);
      const code = await lastCode(t, student.phone);
      const verify = await client(t, tenant.host).post(P.otpVerify, {
        phone: student.phone,
        purpose: 'first_password',
        code,
      });
      expect(verify.status).toBe(200);
    });
  });
});
