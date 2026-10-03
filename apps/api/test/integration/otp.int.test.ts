import { createHash } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { schema, type Db } from '@remix/db';
import { otpVerifyResponseSchema } from '@remix/types/api';
import { RateLimiterUnavailableError } from '../../src/common/rate-limit/rate-limiter';
import { expectProblem } from '../fixtures/problem';
import { jar, lastCode, loginStudent, P, smsTo, wrong } from './support/auth-helpers';
import {
  client,
  createDbTestApp,
  Factory,
  ownerDb,
  PASSWORD,
  uniquePhone,
  type DbTestApp,
  type TenantFixture,
} from './support/db-app';

const NEW_PASSWORD = 'a brand new passphrase';

describe('SMS codes and password tickets (AUTH-02/07/09) against Postgres', () => {
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

  const challengesFor = (phone: string) =>
    db
      .select()
      .from(schema.otpChallenges)
      .where(eq(schema.otpChallenges.phone, phone))
      .orderBy(schema.otpChallenges.createdAt, schema.otpChallenges.id);

  /** Full flow up to a password ticket. */
  async function ticketFor(phone: string, purpose = 'password_reset', host = tenant.host) {
    expect((await client(t, host).post(P.otpRequest, { phone, purpose })).status).toBe(202);
    const code = await lastCode(t, phone);
    const res = await client(t, host).post(P.otpVerify, { phone, purpose, code });
    expect(res.status).toBe(200);
    const { ticket } = otpVerifyResponseSchema.parse(res.body);
    if (!ticket) throw new Error('no ticket');
    return ticket;
  }

  describe('requestOtp — no enumeration', () => {
    it('answers an account and an unknown phone identically, and texts only the account', async () => {
      const student = await f.student(tenant);
      const unknown = uniquePhone();
      const known = await client(t, tenant.host).post(P.otpRequest, {
        phone: student.phone,
        purpose: 'password_reset',
      });
      const missing = await client(t, tenant.host).post(P.otpRequest, {
        phone: unknown,
        purpose: 'password_reset',
      });

      for (const res of [known, missing]) {
        expect(res.status).toBe(202);
        expect(res.headers['cache-control']).toBe('no-store');
      }
      expect(known.text).toBe(missing.text);
      expect(known.body).toEqual({ resendAfterSeconds: 45 });

      // Same database work for both: one challenge row each; only the account's has a user.
      const [knownRow] = await challengesFor(student.phone);
      const [missingRow] = await challengesFor(unknown);
      expect(knownRow?.userId).toBe(student.id);
      expect(missingRow?.userId).toBeNull();
      expect(missingRow?.codeHash).toMatch(/^[0-9a-f]{64}$/);

      expect(await smsTo(t, unknown)).toHaveLength(0);
      const [message] = await smsTo(t, student.phone);
      expect(message?.text).toMatch(/^\d{6} is your Test t-\w+ password code\./);
      expect(message?.sender).toEqual({ gateway: 'remix-wallet', senderId: 'ReMix' });
    });

    it('takes about as long for an unknown phone as for an account (same work)', async () => {
      const median = (xs: number[]) =>
        [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? 0;
      const known: number[] = [];
      const unknown: number[] = [];
      for (let i = 0; i < 12; i += 1) {
        const student = await f.student(tenant);
        for (const [phone, into] of [
          [student.phone, known],
          [uniquePhone(), unknown],
        ] as const) {
          const started = performance.now();
          const res = await client(t, tenant.host).post(P.otpRequest, {
            phone,
            purpose: 'password_reset',
          });
          into.push(performance.now() - started);
          expect(res.status).toBe(202);
        }
      }
      // Generous bounds (shared CI runners): the point is "no order-of-magnitude difference".
      const [a, b] = [median(known), median(unknown)];
      expect(Math.abs(a - b)).toBeLessThan(Math.max(25, 1.5 * Math.min(a, b)));
    });

    it('stores only an HMAC of the code — never the code or a plain hash of it', async () => {
      const student = await f.student(tenant);
      await client(t, tenant.host).post(P.otpRequest, {
        phone: student.phone,
        purpose: 'password_reset',
      });
      const code = await lastCode(t, student.phone);
      const [row] = await challengesFor(student.phone);
      expect(row?.codeHash).not.toContain(code);
      expect(row?.codeHash).not.toBe(createHash('sha256').update(code).digest('hex'));
      expect(JSON.stringify(row)).not.toContain(`"${code}"`);
      // …and never logs it (the dev-only mock SMS log is not wired in tests).
      expect(t.logs.text).not.toContain(code);
    });

    it('a code arriving sooner than 45 s, or a 4th in 15 min, is suppressed silently', async () => {
      const student = await f.student(tenant);
      const ask = () =>
        client(t, tenant.host).post(P.otpRequest, {
          phone: student.phone,
          purpose: 'password_reset',
        });
      expect((await ask()).status).toBe(202);
      const early = await ask();
      expect(early.status).toBe(202);
      expect(early.body).toEqual({ resendAfterSeconds: 45 });
      expect(await smsTo(t, student.phone)).toHaveLength(1);

      t.clock.advance(46_000);
      await ask();
      t.clock.advance(46_000);
      await ask();
      t.clock.advance(46_000);
      expect((await ask()).status).toBe(202); // 4th in the window
      expect(await smsTo(t, student.phone)).toHaveLength(3);
    });

    it('accepts only Sri Lankan mobiles (+947…) and known purposes', async () => {
      const landline = await client(t, tenant.host).post(P.otpRequest, {
        phone: '0112345678',
        purpose: 'password_reset',
      });
      expectProblem(landline, 400, 'VALIDATION_FAILED');
      const purpose = await client(t, tenant.host).post(P.otpRequest, {
        phone: uniquePhone(),
        purpose: 'two_step',
      });
      expectProblem(purpose, 400, 'VALIDATION_FAILED');
    });

    it('fails closed (503) for every phone when the limiter is down — nothing is sent', async () => {
      const student = await f.student(tenant);
      const spy = vi
        .spyOn(t.limiter, 'consume')
        .mockRejectedValue(new RateLimiterUnavailableError(new Error('down')));
      try {
        for (const phone of [student.phone, uniquePhone()]) {
          const res = await client(t, tenant.host).post(P.otpRequest, {
            phone,
            purpose: 'password_reset',
          });
          expectProblem(res, 503, 'INTERNAL');
        }
      } finally {
        spy.mockRestore();
      }
      expect(await smsTo(t, student.phone)).toHaveLength(0);
    });
  });

  describe('verifyOtp', () => {
    it('wrong, expired, superseded and never-sent codes all get the same 400', async () => {
      const student = await f.student(tenant);
      const body = (code: string, phone = student.phone) => ({
        phone,
        purpose: 'password_reset',
        code,
      });
      await client(t, tenant.host).post(P.otpRequest, {
        phone: student.phone,
        purpose: 'password_reset',
      });
      const first = await lastCode(t, student.phone);

      const bad = expectProblem(
        await client(t, tenant.host).post(P.otpVerify, body(wrong(first))),
        400,
        'CODE_INVALID',
      );
      const never = expectProblem(
        await client(t, tenant.host).post(P.otpVerify, body('123456', uniquePhone())),
        400,
        'CODE_INVALID',
      );

      // A newer code supersedes the first one.
      t.clock.advance(46_000);
      await client(t, tenant.host).post(P.otpRequest, {
        phone: student.phone,
        purpose: 'password_reset',
      });
      const second = await lastCode(t, student.phone);
      const superseded = expectProblem(
        await client(t, tenant.host).post(
          P.otpVerify,
          body(first === second ? wrong(first) : first),
        ),
        400,
        'CODE_INVALID',
      );

      t.clock.advance(10 * 60_000 + 1000);
      const expired = expectProblem(
        await client(t, tenant.host).post(P.otpVerify, body(second)),
        400,
        'CODE_INVALID',
      );
      const strip = (p: object) => ({ ...p, requestId: undefined });
      expect(strip(never)).toEqual(strip(bad));
      expect(strip(superseded)).toEqual(strip(bad));
      expect(strip(expired)).toEqual(strip(bad));
    });

    it('accepts spaces in the code, and the 5th wrong guess burns it', async () => {
      const student = await f.student(tenant);
      const payload = { phone: student.phone, purpose: 'password_reset' };
      await client(t, tenant.host).post(P.otpRequest, payload);
      const code = await lastCode(t, student.phone);
      for (let i = 0; i < 5; i += 1) {
        await client(t, tenant.host).post(P.otpVerify, { ...payload, code: wrong(code) });
      }
      const [row] = await challengesFor(student.phone);
      expect(row?.attempts).toBe(5);
      expect(row?.consumedAt).not.toBeNull();
      expectProblem(
        await client(t, tenant.host).post(P.otpVerify, { ...payload, code }),
        400,
        'CODE_INVALID',
      );

      t.clock.advance(46_000);
      await client(t, tenant.host).post(P.otpRequest, payload);
      const fresh = await lastCode(t, student.phone);
      const spaced = `${fresh.slice(0, 3)} ${fresh.slice(3)}`;
      const ok = await client(t, tenant.host).post(P.otpVerify, { ...payload, code: spaced });
      expect(ok.status).toBe(200);
      expect(ok.body.ticket).toMatch(/^[A-Za-z0-9_-]{43}$/);
    });

    it('a right code works once, even under concurrency', async () => {
      const student = await f.student(tenant);
      const payload = { phone: student.phone, purpose: 'password_reset' };
      await client(t, tenant.host).post(P.otpRequest, payload);
      const code = await lastCode(t, student.phone);
      const results = await Promise.all(
        Array.from({ length: 4 }, () =>
          client(t, tenant.host).post(P.otpVerify, { ...payload, code }),
        ),
      );
      expect(results.map((r) => r.status).sort()).toEqual([200, 400, 400, 400]);
    });

    it('a code from one institute is useless on another', async () => {
      const student = await f.student(tenant);
      await f.student(other, { phone: student.phone });
      const payload = { phone: student.phone, purpose: 'password_reset' };
      await client(t, tenant.host).post(P.otpRequest, payload);
      const code = await lastCode(t, student.phone);
      expectProblem(
        await client(t, other.host).post(P.otpVerify, { ...payload, code }),
        400,
        'CODE_INVALID',
      );
      expect((await client(t, tenant.host).post(P.otpVerify, { ...payload, code })).status).toBe(
        200,
      );
    });
  });

  describe('setPassword', () => {
    it('sets the password, revokes every session, forgets trust, and audits', async () => {
      const student = await f.student(tenant);
      const login = await loginStudent(t, tenant.host, student.phone);
      expect(login.status).toBe(200);
      const cookies = jar(login);

      const ticket = await ticketFor(student.phone);
      const res = await client(t, tenant.host).post(P.passwordSet, {
        ticket,
        newPassword: NEW_PASSWORD,
      });
      expect(res.status).toBe(204);
      expect(res.headers['set-cookie']).toBeUndefined(); // does not sign in

      expect((await client(t, tenant.host).get(P.session, cookies)).status).toBe(401);
      expectProblem(await loginStudent(t, tenant.host, student.phone), 401, 'INVALID_CREDENTIALS');
      expect((await loginStudent(t, tenant.host, student.phone, '', NEW_PASSWORD)).status).toBe(
        200,
      );

      const [audit] = await f.audits(tenant, 'auth.password.set');
      expect(audit?.entityId).toBe(student.id);
      expect(audit?.after).toMatchObject({ via: 'password_reset', sessionsRevoked: 1 });
      expect(JSON.stringify(audit)).not.toContain(ticket);

      // Single use.
      expectProblem(
        await client(t, tenant.host).post(P.passwordSet, { ticket, newPassword: NEW_PASSWORD }),
        400,
        'CODE_INVALID',
      );
    });

    it('first_password activates an invited student', async () => {
      const student = await f.student(tenant, { status: 'invited' });
      expectProblem(await loginStudent(t, tenant.host, student.phone), 401, 'INVALID_CREDENTIALS');
      const ticket = await ticketFor(student.phone, 'first_password');
      expect(
        (await client(t, tenant.host).post(P.passwordSet, { ticket, newPassword: NEW_PASSWORD }))
          .status,
      ).toBe(204);
      const [row] = await db
        .select({ status: schema.tenantUsers.status })
        .from(schema.tenantUsers)
        .where(eq(schema.tenantUsers.id, student.id));
      expect(row?.status).toBe('active');
      expect((await loginStudent(t, tenant.host, student.phone, '', NEW_PASSWORD)).status).toBe(
        200,
      );
    });

    it('a ticket is spent exactly once under concurrency', async () => {
      const student = await f.student(tenant);
      const ticket = await ticketFor(student.phone);
      const results = await Promise.all(
        Array.from({ length: 4 }, (_, i) =>
          client(t, tenant.host).post(P.passwordSet, {
            ticket,
            newPassword: `${NEW_PASSWORD} ${i}`,
          }),
        ),
      );
      expect(results.map((r) => r.status).sort()).toEqual([204, 400, 400, 400]);
      const audits = (await f.audits(tenant, 'auth.password.set')).filter(
        (a) => a.entityId === student.id,
      );
      expect(audits).toHaveLength(1);
    });

    it('rejects common passwords, expired tickets and tickets of another institute', async () => {
      const student = await f.student(tenant);
      const ticket = await ticketFor(student.phone);
      const common = expectProblem(
        await client(t, tenant.host).post(P.passwordSet, { ticket, newPassword: 'password123' }),
        400,
        'VALIDATION_FAILED',
      );
      expect(common.errors).toEqual([
        { path: 'newPassword', message: 'This password is too common' },
      ]);
      expectProblem(
        await client(t, other.host).post(P.passwordSet, { ticket, newPassword: NEW_PASSWORD }),
        400,
        'CODE_INVALID',
      );
      t.clock.advance(10 * 60_000 + 1000);
      expectProblem(
        await client(t, tenant.host).post(P.passwordSet, { ticket, newPassword: NEW_PASSWORD }),
        400,
        'CODE_INVALID',
      );
    });
  });

  describe('lockout (AUTH-09)', () => {
    /** n wrong passwords, staying under the 5/min per-phone login limit. */
    async function fail(phone: string, n: number) {
      let last;
      for (let i = 0; i < n; i += 1) {
        if (i > 0 && i % 5 === 0) t.clock.advance(61_000);
        last = await loginStudent(t, tenant.host, phone, '', 'not the password');
      }
      t.clock.advance(61_000);
      return last;
    }

    it('locks after 10 failures — even the right password then says ACCOUNT_LOCKED', async () => {
      const student = await f.student(tenant);
      const ninth = await fail(student.phone, 9);
      if (!ninth) throw new Error('no response');
      expectProblem(ninth, 401, 'INVALID_CREDENTIALS');
      const tenth = await fail(student.phone, 1);
      if (!tenth) throw new Error('no response');
      const locked = expectProblem(tenth, 423, 'ACCOUNT_LOCKED');
      const right = expectProblem(
        await loginStudent(t, tenant.host, student.phone),
        423,
        'ACCOUNT_LOCKED',
      );
      expect({ ...right, requestId: undefined }).toEqual({ ...locked, requestId: undefined });

      const lockouts = (await f.audits(tenant, 'auth.lockout')).filter(
        (a) => a.entityId === student.id,
      );
      expect(lockouts).toHaveLength(1);
    });

    it('an unknown phone answers ACCOUNT_LOCKED after the same 10 failures (no enumeration)', async () => {
      const student = await f.student(tenant);
      const unknown = uniquePhone();
      const known9 = await fail(student.phone, 9);
      const unknown9 = await fail(unknown, 9);
      if (!known9 || !unknown9) throw new Error('no response');
      expectProblem(known9, 401, 'INVALID_CREDENTIALS');
      expectProblem(unknown9, 401, 'INVALID_CREDENTIALS');
      const known10 = await fail(student.phone, 1);
      const unknown10 = await fail(unknown, 1);
      if (!known10 || !unknown10) throw new Error('no response');
      const a = expectProblem(known10, 423, 'ACCOUNT_LOCKED');
      const b = expectProblem(unknown10, 423, 'ACCOUNT_LOCKED');
      expect({ ...a, requestId: undefined }).toEqual({ ...b, requestId: undefined });
    });

    it('an unlock code clears the lockout; a password reset does too', async () => {
      const student = await f.student(tenant);
      await fail(student.phone, 10);
      const payload = { phone: student.phone, purpose: 'unlock' };
      await client(t, tenant.host).post(P.otpRequest, payload);
      const code = await lastCode(t, student.phone);
      const res = await client(t, tenant.host).post(P.otpVerify, { ...payload, code });
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ ticket: null });
      expect((await loginStudent(t, tenant.host, student.phone)).status).toBe(200);
      const [unlock] = (await f.audits(tenant, 'auth.unlock')).filter(
        (a) => a.entityId === student.id,
      );
      expect(unlock).toBeDefined();

      const again = await f.student(tenant);
      await fail(again.phone, 10);
      const ticket = await ticketFor(again.phone);
      await client(t, tenant.host).post(P.passwordSet, { ticket, newPassword: NEW_PASSWORD });
      expect((await loginStudent(t, tenant.host, again.phone, '', NEW_PASSWORD)).status).toBe(200);
    });

    it('an unlock code is never sent to an account that is not locked', async () => {
      const student = await f.student(tenant);
      const res = await client(t, tenant.host).post(P.otpRequest, {
        phone: student.phone,
        purpose: 'unlock',
      });
      expect(res.status).toBe(202);
      expect(await smsTo(t, student.phone)).toHaveLength(0);
      const [row] = await db
        .select({ userId: schema.otpChallenges.userId })
        .from(schema.otpChallenges)
        .where(
          and(
            eq(schema.otpChallenges.phone, student.phone),
            eq(schema.otpChallenges.purpose, 'unlock'),
          ),
        );
      expect(row?.userId).toBeNull();
    });
  });

  it('PASSWORD fixture still signs in (sanity)', async () => {
    const student = await f.student(tenant);
    expect((await loginStudent(t, tenant.host, student.phone, '', PASSWORD)).status).toBe(200);
  });
});
