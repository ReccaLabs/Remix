import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Db } from '@remix/db';
import {
  listInvoicesResponseSchema,
  listPaymentsResponseSchema,
  paymentSchema,
  receiptSchema,
  studentFeesSchema,
  type StaffRole,
} from '@remix/types/api';
import { expectProblem } from '../fixtures/problem';
import {
  createDbTestApp,
  Factory,
  ownerDb,
  type DbTestApp,
  type TenantFixture,
  type UserFixture,
} from './support/db-app';
import { feesOf, lines } from './support/fees';
import { api, signInStaff, signInStudent, staffByRole, type Api } from './support/people';

const FEE = 250_000;
const GHOST = '0193f1c2-7b1d-7c3e-9a4f-000000000999';
const ROLES: StaffRole[] = ['owner', 'admin', 'cashier', 'teacher', 'gatekeeper'];
const CAN_READ: Record<StaffRole, boolean> = {
  owner: true,
  admin: true,
  cashier: true,
  teacher: false,
  gatekeeper: false,
};

describe('fee read and reversal endpoints (FEE-01, FEE-11) against Postgres', () => {
  let t: DbTestApp;
  let db: Db;
  let f: Factory;
  let tenant: TenantFixture;
  let other: TenantFixture;
  let staff: Record<StaffRole, { user: UserFixture; api: Api }>;
  let otherStaff: Record<StaffRole, { user: UserFixture; api: Api }>;
  let student: UserFixture;
  let otherStudent: UserFixture;
  let paymentId: string;
  let receiptId: string;
  let otherPaymentId: string;
  let otherReceiptId: string;
  let classId: string;

  async function seed(tn: TenantFixture, name: string) {
    const klass = await f.klass(tn, { name, feeCents: FEE });
    const s = await f.student(tn, { name: `${name} student` });
    await f.enroll(tn, s.id, klass, { from: '2026-09-01' });
    const fees = feesOf(t);
    await fees.generateInvoices(tn.id, '2026-10');
    const [l] = await lines(db, tn.id);
    const paid = await fees.recordPayment(tn.id, {
      method: 'cash',
      amountCents: FEE,
      lines: [l!.id],
      idempotencyKey: `seed-${name}`,
      receivedBy: null,
    });
    return { klass, s, paid };
  }

  beforeAll(async () => {
    t = await createDbTestApp();
    db = ownerDb();
    f = new Factory(db);
    tenant = await f.tenant('active');
    other = await f.tenant('active');
    staff = await staffByRole(t, f, tenant);
    otherStaff = await staffByRole(t, f, other);
    const mine = await seed(tenant, 'Mine');
    const theirs = await seed(other, 'Theirs');
    student = mine.s;
    classId = mine.klass;
    otherStudent = theirs.s;
    paymentId = mine.paid.payment.id;
    receiptId = mine.paid.receiptId!;
    otherPaymentId = theirs.paid.payment.id;
    otherReceiptId = theirs.paid.receiptId!;
  });
  afterAll(async () => {
    await t.close();
    await db.$client.end();
  });

  const reads = () =>
    [
      ['listInvoices', '/api/v1/admin/invoices'],
      ['studentFees', `/api/v1/admin/students/${student.id}/fees`],
      ['listPayments', '/api/v1/admin/payments'],
      ['getPayment', `/api/v1/admin/payments/${paymentId}`],
      ['getReceipt', `/api/v1/admin/receipts/${receiptId}`],
    ] as const;

  describe('per role', () => {
    for (const role of ROLES) {
      it(`${role}: reads are ${CAN_READ[role] ? 'allowed' : 'forbidden'}`, async () => {
        for (const [name, url] of reads()) {
          const res = await staff[role].api.get(url);
          if (CAN_READ[role]) expect(res.status, name).toBe(200);
          else {
            expect(res.status, name).toBe(403);
            expectProblem(res, 403, 'FORBIDDEN');
          }
        }
      });
    }

    for (const role of ROLES) {
      it(`${role}: reversal is ${role === 'owner' ? 'allowed' : 'forbidden'} and writes nothing when refused`, async () => {
        // A fresh payment per role so the owner's success does not hide the others' refusals.
        const k = await f.klass(tenant, { name: `Rev ${role}`, feeCents: FEE });
        const s = await f.student(tenant);
        await f.enroll(tenant, s.id, k, { from: '2026-09-01' });
        await feesOf(t).generateInvoices(tenant.id, '2026-10');
        const l = (await lines(db, tenant.id)).find((x) => x.class_id === k)!;
        const p = await feesOf(t).recordPayment(tenant.id, {
          method: 'cash',
          amountCents: FEE,
          lines: [l.id],
          idempotencyKey: `rev-${role}`,
          receivedBy: null,
        });
        const res = await staff[role].api.post(`/api/v1/admin/payments/${p.payment.id}/reverse`, {
          reason: 'Customer asked for it',
        });
        if (role === 'owner') {
          expect(res.status).toBe(200);
          const body = paymentSchema.strict().parse(res.body);
          expect(body).toMatchObject({
            method: 'reversal',
            amountCents: -FEE,
            reversesPaymentId: p.payment.id,
          });
        } else {
          expectProblem(res, 403, 'FORBIDDEN');
          const got = await staff.owner.api.get(`/api/v1/admin/payments/${p.payment.id}`);
          expect(got.body.reversedByPaymentId).toBeNull();
        }
      });
    }

    it('anonymous callers and students are refused', async () => {
      for (const [, url] of reads()) {
        expect((await api(t, tenant.host).get(url)).status).toBe(401);
      }
      const cookie = await signInStudent(t, tenant, student);
      for (const [, url] of reads()) {
        expect((await api(t, tenant.host, cookie).get(url)).status).toBe(403);
      }
      const rev = await api(t, tenant.host, cookie).post(
        `/api/v1/admin/payments/${paymentId}/reverse`,
        { reason: 'student attempt' },
      );
      expect(rev.status).toBe(403);
    });
  });

  describe('responses match the contract', () => {
    it('listInvoices, listPayments, studentFees, getPayment and getReceipt parse strictly', async () => {
      const inv = await staff.cashier.api.get('/api/v1/admin/invoices?month=2026-10-01&q=Mine');
      const parsed = listInvoicesResponseSchema.strict().parse(inv.body);
      expect(parsed.items.every((i) => i.month === '2026-10-01')).toBe(true);
      expect(parsed.items).toHaveLength(1);
      expect(parsed.items[0]).toMatchObject({
        studentId: student.id,
        totalCents: FEE,
        paidCents: FEE,
        status: 'paid',
      });
      const pays = await staff.cashier.api.get('/api/v1/admin/payments?method=cash');
      expect(listPaymentsResponseSchema.strict().parse(pays.body).items.length).toBeGreaterThan(0);
      studentFeesSchema
        .strict()
        .parse((await staff.cashier.api.get(`/api/v1/admin/students/${student.id}/fees`)).body);
      paymentSchema
        .strict()
        .parse((await staff.cashier.api.get(`/api/v1/admin/payments/${paymentId}`)).body);
      const receipt = receiptSchema
        .strict()
        .parse((await staff.cashier.api.get(`/api/v1/admin/receipts/${receiptId}`)).body);
      expect(receipt.number).toMatch(/^[A-Z]{2,4}-R-26-\d{5}$/);
      expect((await staff.owner.api.get('/api/v1/admin/invoices')).headers['cache-control']).toBe(
        'no-store',
      );
    });

    it('filters invoices by status, class and search, and rejects bad queries', async () => {
      expect(
        (await staff.owner.api.get('/api/v1/admin/invoices?filter=paid&q=Mine')).body.items,
      ).toHaveLength(1);
      expect(
        (await staff.owner.api.get('/api/v1/admin/invoices?filter=unpaid&q=Mine')).body.items,
      ).toHaveLength(0);
      expect(
        (await staff.owner.api.get('/api/v1/admin/invoices?filter=overdue&q=Mine')).body.items,
      ).toHaveLength(0);
      expect(
        (await staff.owner.api.get(`/api/v1/admin/invoices?classId=${classId}`)).body.items,
      ).toHaveLength(1);
      expect(
        (await staff.owner.api.get(`/api/v1/admin/invoices?classId=${GHOST}`)).body.items,
      ).toHaveLength(0);
      expect((await staff.owner.api.get('/api/v1/admin/invoices?q=Mine')).body.items).toHaveLength(
        1,
      );
      expect(
        (await staff.owner.api.get('/api/v1/admin/invoices?q=Theirs')).body.items,
      ).toHaveLength(0);
      expect((await staff.owner.api.get('/api/v1/admin/invoices?q=%25')).body.items).toHaveLength(
        0,
      );
      expectProblem(
        await staff.owner.api.get('/api/v1/admin/invoices?month=not-a-month'),
        400,
        'VALIDATION_FAILED',
      );
      expectProblem(
        await staff.owner.api.get('/api/v1/admin/payments?from=2026-12-01&to=2026-01-01'),
        400,
        'VALIDATION_FAILED',
      );
    });

    it('reversal needs a reason, conflicts the second time and shows on the original', async () => {
      const k = await f.klass(tenant, { name: 'Rev twice', feeCents: FEE });
      const s = await f.student(tenant);
      await f.enroll(tenant, s.id, k, { from: '2026-09-01' });
      await feesOf(t).generateInvoices(tenant.id, '2026-10');
      const l = (await lines(db, tenant.id)).find((x) => x.class_id === k)!;
      const p = await feesOf(t).recordPayment(tenant.id, {
        method: 'cash',
        amountCents: FEE,
        lines: [l.id],
        idempotencyKey: 'rev-twice',
        receivedBy: null,
      });
      const url = `/api/v1/admin/payments/${p.payment.id}/reverse`;
      expectProblem(await staff.owner.api.post(url, {}), 400, 'VALIDATION_FAILED');
      expectProblem(await staff.owner.api.post(url, { reason: 'x' }), 400, 'VALIDATION_FAILED');
      const ok = await staff.owner.api.post(url, { reason: 'Wrong student' });
      expect(ok.status).toBe(200);
      expectProblem(await staff.owner.api.post(url, { reason: 'Wrong student' }), 409, 'CONFLICT');
      const original = await staff.cashier.api.get(`/api/v1/admin/payments/${p.payment.id}`);
      expect(original.body.reversedByPaymentId).toBe(ok.body.id);
      const fees = await staff.cashier.api.get(`/api/v1/admin/students/${s.id}/fees`);
      expect(fees.body.openLines).toHaveLength(1);
      expect(fees.body.openLines[0]).toMatchObject({ paidCents: 0, openCents: FEE, paid: false });
      const receipt = await staff.cashier.api.get(`/api/v1/admin/receipts/${p.receiptId}`);
      expect(receipt.body.reversedAt).not.toBeNull();
    });
  });

  describe('cross-tenant', () => {
    it("tenant B's staff cannot see or touch tenant A's ledger, even with the right ids", async () => {
      const b = otherStaff.owner.api;
      for (const url of [
        `/api/v1/admin/students/${student.id}/fees`,
        `/api/v1/admin/payments/${paymentId}`,
        `/api/v1/admin/receipts/${receiptId}`,
      ]) {
        expectProblem(await b.get(url), 404, 'NOT_FOUND');
      }
      expectProblem(
        await b.post(`/api/v1/admin/payments/${paymentId}/reverse`, {
          reason: 'Cross tenant attempt',
        }),
        404,
        'NOT_FOUND',
      );
      const inv = await b.get('/api/v1/admin/invoices');
      expect((inv.body.items as { studentId: string }[]).map((i) => i.studentId)).toEqual([
        otherStudent.id,
      ]);
      expect(inv.body.total).toBe(1);
      const pays = await b.get('/api/v1/admin/payments');
      expect((pays.body.items as { id: string }[]).map((p) => p.id)).toEqual([otherPaymentId]);
      expect((await b.get(`/api/v1/admin/payments?studentId=${student.id}`)).body.items).toEqual(
        [],
      );
      expect((await b.get(`/api/v1/admin/invoices?classId=${classId}`)).body.items).toEqual([]);
      // And A is untouched by all of it.
      const mine = await staff.owner.api.get(`/api/v1/admin/payments/${paymentId}`);
      expect(mine.body.reversedByPaymentId).toBeNull();
    });

    it("A's staff cannot read B's records either (symmetry)", async () => {
      for (const url of [
        `/api/v1/admin/payments/${otherPaymentId}`,
        `/api/v1/admin/receipts/${otherReceiptId}`,
      ]) {
        expectProblem(await staff.owner.api.get(url), 404, 'NOT_FOUND');
      }
      expectProblem(await staff.owner.api.get(`/api/v1/admin/payments/${GHOST}`), 404, 'NOT_FOUND');
      expectProblem(
        await staff.owner.api.get('/api/v1/admin/payments/not-a-uuid'),
        400,
        'VALIDATION_FAILED',
      );
    });

    it("A's host with B's session cookie is refused (sessions are tenant-bound)", async () => {
      // Re-use B's cookie against A's host: the session lookup is tenant-scoped, so it is anonymous.
      const cookie = await signInStaff(t, other, otherStaff.owner.user);
      const res = await api(t, tenant.host, cookie).get(`/api/v1/admin/payments/${paymentId}`);
      expect(res.status).toBe(401);
    });
  });
});
