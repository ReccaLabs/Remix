import { randomBytes, randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Db } from '@remix/db';
import {
  checkoutResponseSchema,
  checkoutStatusSchema,
  type CheckoutResponse,
  type StaffRole,
} from '@remix/types/api';
import { checkoutHash, notifySignature } from '../../src/integrations/payment/payhere.provider';
import { expectProblem } from '../fixtures/problem';
import { createDbTestApp, Factory, ownerDb, type DbTestApp, type TenantFixture, type UserFixture } from './support/db-app';
import { assertLedgerInvariants, feesOf, lines, scalar } from './support/fees';
import { api, signInStudent, staffByRole, type Api } from './support/people';

const SECRET = 'test-only-payhere-secret-a';
const OTHER_SECRET = 'test-only-payhere-secret-b';
const MERCHANT = '1211149';
const OTHER_MERCHANT = '1211150';
const CHECKOUT = '/api/v1/me/payments/checkout';
const ROLES = ['owner', 'admin', 'cashier', 'teacher', 'gatekeeper'] as const;
const randomIp = () => `198.18.${randomBytes(1)[0] ?? 0}.${randomBytes(1)[0] ?? 0}`;

interface Learner {
  tenant: TenantFixture;
  student: UserFixture;
  api: Api;
  lineIds: string[];
}

describe('PayHere card payments FEE-03/04 + SET-02 test, real Postgres RLS', () => {
  let t: DbTestApp;
  let db: Db;
  let f: Factory;
  let tenant: TenantFixture;
  let other: TenantFixture;
  let staff: Record<StaffRole, { user: UserFixture; api: Api }>;
  let otherOwner: Api;

  async function learner(tn: TenantFixture, name = 'Card class'): Promise<Learner> {
    const student = await f.student(tn);
    const k = await f.klass(tn, { name, feeCents: 250_000 });
    await f.enroll(tn, student.id, k, { from: '2026-09-01' });
    await feesOf(t).generateInvoices(tn.id, '2026-09');
    await feesOf(t).generateInvoices(tn.id, '2026-10');
    const lineIds = (await lines(db, tn.id)).filter((l) => l.student_id === student.id).map((l) => l.id);
    return { tenant: tn, student, api: api(t, tn.host, await signInStudent(t, tn, student)), lineIds };
  }

  async function checkout(who: Learner, lineIds = who.lineIds): Promise<CheckoutResponse> {
    const res = await who.api.post(CHECKOUT, { lineIds });
    expect(res.status, res.text).toBe(200);
    return checkoutResponseSchema.strict().parse(res.body);
  }

  interface NotifyOptions {
    secret?: string;
    host?: string;
    slug?: string;
    fields?: Record<string, string>;
    sign?: boolean;
  }

  /** PayHere's server-to-server POST: form-encoded, signed with the merchant secret. */
  function notify(tn: TenantFixture, orderId: string, amount: string, statusCode: string, o: NotifyOptions = {}) {
    const fields: Record<string, string> = {
      merchant_id: tn === other ? OTHER_MERCHANT : MERCHANT,
      order_id: orderId,
      payment_id: `3200${randomBytes(4).readUInt32BE(0)}`,
      payhere_amount: amount,
      payhere_currency: 'LKR',
      status_code: statusCode,
      method: 'VISA',
      status_message: 'Successfully completed the payment.',
      card_holder_name: 'Sample Holder',
      card_no: '************1292',
      card_expiry: '12/30',
      custom_1: 'fees',
      ...o.fields,
    };
    if (o.sign !== false) {
      fields.md5sig = notifySignature(
        {
          merchant_id: fields.merchant_id ?? '',
          order_id: fields.order_id ?? '',
          payhere_amount: fields.payhere_amount ?? '',
          payhere_currency: fields.payhere_currency ?? '',
          status_code: fields.status_code ?? '',
        },
        o.secret ?? (tn === other ? OTHER_SECRET : SECRET),
      );
    }
    return {
      fields,
      send: () =>
        request(t.server)
          .post(`/api/v1/webhooks/payhere/${o.slug ?? tn.slug}`)
          .set('Host', o.host ?? tn.host)
          .set('X-Forwarded-For', randomIp())
          .type('form')
          .send(new URLSearchParams(fields).toString()),
    };
  }

  const count = (tn: TenantFixture, query: ReturnType<typeof sql>) => scalar<number>(db, tn.id, query);
  const cardPayments = (tn: TenantFixture, where = sql`true`) =>
    count(tn, sql`select count(*)::int as v from payments where method = 'card' and ${where}`);
  const checkoutRow = async (tn: TenantFixture, id: string) =>
    (
      await scalar<{ status: string; payment_id: string | null; chargeback_at: string | null; status_code: number | null }>(
        db,
        tn.id,
        sql`select row_to_json(c) as v from payhere_checkouts c where id = ${id}::uuid`,
      )
    );
  const status = async (who: Learner, id: string) => {
    const res = await who.api.get(`${CHECKOUT}/${id}`);
    expect(res.status, res.text).toBe(200);
    return checkoutStatusSchema.strict().parse(res.body);
  };

  beforeAll(async () => {
    t = await createDbTestApp({ INTEGRATIONS_KEY: Buffer.alloc(32, 7).toString('base64') });
    db = ownerDb();
    f = new Factory(db);
    tenant = await f.tenant();
    other = await f.tenant();
    staff = await staffByRole(t, f, tenant);
    otherOwner = (await staffByRole(t, f, other, ['owner'])).owner.api;
    const enable = { mode: 'sandbox', enabled: true };
    expect((await staff.owner.api.patch('/api/v1/admin/settings/payhere', { ...enable, merchantId: MERCHANT, merchantSecret: SECRET })).status).toBe(200);
    expect((await otherOwner.patch('/api/v1/admin/settings/payhere', { ...enable, merchantId: OTHER_MERCHANT, merchantSecret: OTHER_SECRET })).status).toBe(200);
  });
  afterAll(async () => {
    await t.close();
    await db.$client.end();
  });

  describe('createCheckout and checkoutStatus (FEE-04)', () => {
    it('signs a sandbox order for the open total of whole months; the secret never leaves the API', async () => {
      const me = await learner(tenant);
      const myFees = await me.api.get('/api/v1/me/fees');
      expect(myFees.body.cardEnabled).toBe(true);
      const res = await me.api.post(CHECKOUT, { lineIds: me.lineIds });
      expect(res.headers['cache-control']).toBe('no-store');
      const body = checkoutResponseSchema.strict().parse(res.body);
      expect(body.actionUrl).toBe('https://sandbox.payhere.lk/pay/checkout');
      expect(body.fields).toMatchObject({
        merchant_id: MERCHANT,
        order_id: body.checkoutId,
        amount: '5000.00',
        currency: 'LKR',
        notify_url: `http://${tenant.host}/api/v1/webhooks/payhere/${tenant.slug}`,
        return_url: `http://${tenant.host}/app/pay/return?checkout=${body.checkoutId}`,
        cancel_url: `http://${tenant.host}/app/pay/cancel?checkout=${body.checkoutId}`,
        hash: checkoutHash(MERCHANT, body.checkoutId, '5000.00', 'LKR', SECRET),
      });
      for (const key of ['first_name', 'last_name', 'phone', 'address', 'city', 'country', 'items'])
        expect(body.fields[key]?.trim().length, key).toBeGreaterThan(0);
      expect(JSON.stringify(body)).not.toContain(SECRET);
      expect(t.logs.text).not.toContain(SECRET);
      expect(await status(me, body.checkoutId)).toEqual({ checkoutId: body.checkoutId, status: 'pending', receiptId: null });
      expect(await count(tenant, sql`select count(*)::int as v from payhere_checkout_lines where checkout_id = ${body.checkoutId}::uuid`)).toBe(2);
      const audit = (await f.audits(tenant, 'checkout.create')).find((a) => a.entityId === body.checkoutId);
      expect(audit?.after).toMatchObject({ amountCents: 500_000, lines: 2 });
    });

    it('refuses other students’ months, repeated months, unknown fields and disabled card payments', async () => {
      const me = await learner(tenant, 'Refusals class');
      const peer = await learner(tenant, 'Peer class');
      expectProblem(await me.api.post(CHECKOUT, { lineIds: [peer.lineIds[0]] }), 404, 'NOT_FOUND');
      expectProblem(await me.api.post(CHECKOUT, { lineIds: [me.lineIds[0], me.lineIds[0]] }), 400, 'VALIDATION_FAILED');
      expectProblem(await me.api.post(CHECKOUT, { lineIds: me.lineIds, amountCents: 1 }), 400, 'VALIDATION_FAILED');
      expectProblem(await me.api.post(CHECKOUT, { lineIds: [randomUUID()] }), 404, 'NOT_FOUND');
      const off = await f.tenant();
      const offLearner = await learner(off, 'Off class');
      expect((await offLearner.api.get('/api/v1/me/fees')).body.cardEnabled).toBe(false);
      expectProblem(await offLearner.api.post(CHECKOUT, { lineIds: offLearner.lineIds }), 409, 'PAYMENT_PROVIDER_UNAVAILABLE');
      // A form post to the JSON API is still refused by the CSRF guard.
      const form = await request(t.server).post(CHECKOUT).set('Host', tenant.host).type('form').send('lineIds=x');
      expect(form.status).toBe(415);
    });

    it('is student-only; staff, anonymous callers and other students cannot use or read it', async () => {
      const me = await learner(tenant, 'Roles class');
      const { checkoutId } = await checkout(me);
      for (const role of ROLES) {
        expectProblem(await staff[role].api.post(CHECKOUT, { lineIds: me.lineIds }), 403, 'FORBIDDEN');
        expectProblem(await staff[role].api.get(`${CHECKOUT}/${checkoutId}`), 403, 'FORBIDDEN');
      }
      expectProblem(await api(t, tenant.host).post(CHECKOUT, { lineIds: me.lineIds }), 401, 'UNAUTHENTICATED');
      expectProblem(await api(t, tenant.host).get(`${CHECKOUT}/${checkoutId}`), 401, 'UNAUTHENTICATED');
      const peer = await learner(tenant, 'Peer roles class');
      expectProblem(await peer.api.get(`${CHECKOUT}/${checkoutId}`), 404, 'NOT_FOUND');
      const foreign = await learner(other, 'Foreign roles class');
      expectProblem(await foreign.api.get(`${CHECKOUT}/${checkoutId}`), 404, 'NOT_FOUND');
    });

    it('rate limits checkout creation per student', async () => {
      const me = await learner(tenant, 'Limit class');
      for (let i = 0; i < 10; i += 1) expect((await me.api.post(CHECKOUT, { lineIds: me.lineIds })).status).toBe(200);
      expectProblem(await me.api.post(CHECKOUT, { lineIds: me.lineIds }), 429, 'RATE_LIMITED');
    });
  });

  describe('notify webhook', () => {
    it('records one card payment for a verified success, answers 200, and replays change nothing', async () => {
      const me = await learner(tenant, 'Success class');
      const { checkoutId } = await checkout(me);
      const n = notify(tenant, checkoutId, '5000.00', '2');
      const res = await n.send();
      expect(res.status, res.text).toBe(200);
      expect(res.text).toBe('OK');
      expect(await cardPayments(tenant, sql`student_id = ${me.student.id}::uuid`)).toBe(1);
      const paid = (await lines(db, tenant.id)).filter((l) => me.lineIds.includes(l.id));
      expect(paid.every((l) => l.paid === l.amount_cents)).toBe(true);
      const s = await status(me, checkoutId);
      expect(s.status).toBe('paid');
      expect(s.receiptId).not.toBeNull();
      const payment = await scalar<{ provider_ref: string; idempotency_key: string; received_by: string | null; needs_refund: boolean }>(
        db,
        tenant.id,
        sql`select row_to_json(p) as v from payments p where student_id = ${me.student.id}::uuid`,
      );
      expect(payment).toMatchObject({ provider_ref: n.fields.payment_id, idempotency_key: `payhere:${checkoutId}`, received_by: null, needs_refund: false });
      // Receipt PDF/SMS jobs were queued after commit, keyed by the payment.
      expect(t.jobs.jobs.some((j) => j.queue === 'receipts' && JSON.stringify(j.payload).includes(s.receiptId ?? '-'))).toBe(true);
      // Replays (same or a fresh payment id) are answered 200 and write nothing.
      expect((await n.send()).status).toBe(200);
      expect((await notify(tenant, checkoutId, '5000.00', '2').send()).status).toBe(200);
      expect(await cardPayments(tenant, sql`student_id = ${me.student.id}::uuid`)).toBe(1);
      // The months are now paid: a new checkout for them is refused.
      expectProblem(await me.api.post(CHECKOUT, { lineIds: me.lineIds }), 409, 'ALREADY_PAID');
      // Nothing card-related or secret reached the logs or the audit rows.
      const audits = JSON.stringify(await f.audits(tenant));
      for (const leak of [SECRET, '1292', 'Sample Holder', n.fields.md5sig ?? '-']) {
        expect(t.logs.text).not.toContain(leak);
        expect(audits).not.toContain(leak);
      }
      await assertLedgerInvariants(db, t, tenant);
    });

    it('two concurrent notifications for one order create one payment', async () => {
      const me = await learner(tenant, 'Concurrent class');
      const { checkoutId } = await checkout(me);
      const results = await Promise.all([
        notify(tenant, checkoutId, '5000.00', '2').send(),
        notify(tenant, checkoutId, '5000.00', '2').send(),
        notify(tenant, checkoutId, '5000.00', '2').send(),
      ]);
      expect(results.map((r) => r.status)).toEqual([200, 200, 200]);
      expect(await cardPayments(tenant, sql`student_id = ${me.student.id}::uuid`)).toBe(1);
      await assertLedgerInvariants(db, t, tenant);
    });

    it('rejects bad signatures, foreign merchants and malformed bodies with a generic answer', async () => {
      const me = await learner(tenant, 'Forgery class');
      const { checkoutId } = await checkout(me);
      const before = (await f.audits(tenant, 'payhere.notify_rejected')).length;
      const forged = await notify(tenant, checkoutId, '5000.00', '2', { secret: 'guessed-secret' }).send();
      const problem = expectProblem(forged, 403, 'FORBIDDEN');
      expect(problem.title).toBe('Notification rejected');
      // Correct secret, but another merchant id.
      expectProblem(await notify(tenant, checkoutId, '5000.00', '2', { fields: { merchant_id: '9999999' } }).send(), 403, 'FORBIDDEN');
      // Tampered after signing.
      const resigned = notify(tenant, checkoutId, '5000.00', '-1');
      expectProblem(
        await request(t.server)
          .post(`/api/v1/webhooks/payhere/${tenant.slug}`)
          .set('Host', tenant.host)
          .type('form')
          .send(new URLSearchParams({ ...resigned.fields, status_code: '2' }).toString()),
        403,
        'FORBIDDEN',
      );
      expectProblem(await notify(tenant, checkoutId, '5000.00', '2', { sign: false }).send(), 400, 'VALIDATION_FAILED');
      expectProblem(await notify(tenant, 'not-a-uuid', '5000.00', '2').send(), 400, 'VALIDATION_FAILED');
      const json = await request(t.server)
        .post(`/api/v1/webhooks/payhere/${tenant.slug}`)
        .set('Host', tenant.host)
        .set('Content-Type', 'application/json')
        .send(JSON.stringify(notify(tenant, checkoutId, '5000.00', '2').fields));
      expectProblem(json, 415, 'VALIDATION_FAILED');
      expect(await cardPayments(tenant, sql`student_id = ${me.student.id}::uuid`)).toBe(0);
      expect((await checkoutRow(tenant, checkoutId)).status).toBe('pending');
      expect((await f.audits(tenant, 'payhere.notify_rejected')).length).toBeGreaterThanOrEqual(before + 5);
      expect(t.logs.text).not.toContain(SECRET);
    });

    it('answers 200 but records nothing when amount, currency or order do not match', async () => {
      const me = await learner(tenant, 'Mismatch class');
      const { checkoutId } = await checkout(me);
      expect((await notify(tenant, checkoutId, '4999.99', '2').send()).status).toBe(200);
      expect((await notify(tenant, checkoutId, '5000.00', '2', { fields: { payhere_currency: 'USD' } }).send()).status).toBe(200);
      expect((await notify(tenant, randomUUID(), '5000.00', '2').send()).status).toBe(200);
      expect(await cardPayments(tenant, sql`student_id = ${me.student.id}::uuid`)).toBe(0);
      expect((await checkoutRow(tenant, checkoutId)).status).toBe('pending');
      const reasons = (await f.audits(tenant, 'payhere.notify_rejected')).map((a) => (a.after as { reason?: string } | null)?.reason);
      expect(reasons).toEqual(expect.arrayContaining(['mismatch', 'unknown_order']));
    });

    it('records a late success after expiry: the money was taken', async () => {
      const me = await learner(tenant, 'Late class');
      const { checkoutId } = await checkout(me);
      t.clock.advance(31 * 60 * 1000);
      expect((await status(me, checkoutId)).status).toBe('expired');
      expect((await notify(tenant, checkoutId, '5000.00', '2').send()).status).toBe(200);
      expect(await status(me, checkoutId)).toMatchObject({ status: 'paid' });
      expect(await cardPayments(tenant, sql`student_id = ${me.student.id}::uuid`)).toBe(1);
      const audit = (await f.audits(tenant, 'payhere.notify')).find((a) => a.entityId === checkoutId);
      expect(audit?.after).toMatchObject({ outcome: 'paid', late: true });
    });

    it('moves pending → cancelled/failed, never back, and flags a chargeback without reversing', async () => {
      const me = await learner(tenant, 'States class');
      const a = await checkout(me);
      expect((await notify(tenant, a.checkoutId, '5000.00', '0').send()).status).toBe(200);
      expect((await status(me, a.checkoutId)).status).toBe('pending');
      expect((await notify(tenant, a.checkoutId, '5000.00', '-1').send()).status).toBe(200);
      expect((await status(me, a.checkoutId)).status).toBe('cancelled');
      expect((await notify(tenant, a.checkoutId, '5000.00', '0').send()).status).toBe(200);
      expect((await status(me, a.checkoutId)).status).toBe('cancelled');
      const b = await checkout(me);
      expect((await notify(tenant, b.checkoutId, '5000.00', '-2').send()).status).toBe(200);
      expect((await status(me, b.checkoutId)).status).toBe('failed');
      const c = await checkout(me);
      expect((await notify(tenant, c.checkoutId, '5000.00', '2').send()).status).toBe(200);
      expect((await notify(tenant, c.checkoutId, '5000.00', '-2').send()).status).toBe(200);
      expect((await status(me, c.checkoutId)).status).toBe('paid');
      expect((await notify(tenant, c.checkoutId, '5000.00', '-3').send()).status).toBe(200);
      const row = await checkoutRow(tenant, c.checkoutId);
      expect(row.status).toBe('paid');
      expect(row.chargeback_at).not.toBeNull();
      expect(await count(tenant, sql`select count(*)::int as v from payments where method = 'reversal' and student_id = ${me.student.id}::uuid`)).toBe(0);
      expect((await f.audits(tenant, 'payhere.chargeback')).some((x) => x.entityId === c.checkoutId)).toBe(true);
      await assertLedgerInvariants(db, t, tenant);
    });

    it('keeps a second paid order for the same months unallocated and flagged for refund', async () => {
      const me = await learner(tenant, 'Double class');
      const a = await checkout(me);
      const b = await checkout(me);
      expect((await notify(tenant, a.checkoutId, '5000.00', '2').send()).status).toBe(200);
      expect((await notify(tenant, b.checkoutId, '5000.00', '2').send()).status).toBe(200);
      expect(await cardPayments(tenant, sql`student_id = ${me.student.id}::uuid`)).toBe(2);
      expect(await cardPayments(tenant, sql`student_id = ${me.student.id}::uuid and needs_refund and unallocated_cents = 500000`)).toBe(1);
      await assertLedgerInvariants(db, t, tenant);
    });

    it('isolates tenants: another tenant’s order at this slug is unknown, its secret is invalid here', async () => {
      const me = await learner(tenant, 'Cross class');
      const { checkoutId } = await checkout(me);
      // Signed correctly for tenant B, posted to B: B has no such order.
      expect((await notify(other, checkoutId, '5000.00', '2').send()).status).toBe(200);
      // Signed with A's secret, posted to B: B verifies with its own secret.
      expectProblem(await notify(other, checkoutId, '5000.00', '2', { secret: SECRET, fields: { merchant_id: OTHER_MERCHANT } }).send(), 403, 'FORBIDDEN');
      // A's host with B's slug: the slug must belong to the host's tenant.
      expectProblem(await notify(tenant, checkoutId, '5000.00', '2', { slug: other.slug }).send(), 404, 'NOT_FOUND');
      expect(await cardPayments(tenant, sql`student_id = ${me.student.id}::uuid`)).toBe(0);
      expect(await cardPayments(other)).toBe(0);
      expect((await checkoutRow(tenant, checkoutId)).status).toBe('pending');
    });
  });

  describe('owner test payment (SET-02)', () => {
    it('creates a test order that only moves lastTest, never the ledger', async () => {
      const before = await count(tenant, sql`select count(*)::int as v from payments`);
      const res = await staff.owner.api.post('/api/v1/admin/settings/payhere/test');
      expect(res.status, res.text).toBe(200);
      const body = checkoutResponseSchema.strict().parse(res.body);
      expect(body.fields).toMatchObject({ amount: '10.00', return_url: `http://${tenant.host}/admin/settings/payments` });
      expect((await staff.owner.api.get('/api/v1/admin/settings/payhere')).body.lastTest).toMatchObject({ status: 'pending' });
      expect((await notify(tenant, body.checkoutId, '10.00', '2', { fields: { custom_1: 'settings-test' } }).send()).status).toBe(200);
      expect((await staff.owner.api.get('/api/v1/admin/settings/payhere')).body.lastTest).toMatchObject({ status: 'paid' });
      const failed = checkoutResponseSchema.parse((await staff.owner.api.post('/api/v1/admin/settings/payhere/test')).body);
      expect((await notify(tenant, failed.checkoutId, '10.00', '-2').send()).status).toBe(200);
      expect((await staff.owner.api.get('/api/v1/admin/settings/payhere')).body.lastTest).toMatchObject({ status: 'failed' });
      expect(await count(tenant, sql`select count(*)::int as v from payments`)).toBe(before);
      // A student cannot read a test order through the status poll.
      const me = await learner(tenant, 'Test poll class');
      expectProblem(await me.api.get(`${CHECKOUT}/${body.checkoutId}`), 404, 'NOT_FOUND');
    });
  });
});
