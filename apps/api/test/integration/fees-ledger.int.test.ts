import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { schema, withTenant, type Db } from '@remix/db';
import { AppException } from '../../src/common/errors/app-exception';
import type { AuthSession } from '../../src/common/auth/session-authenticator';
import { FEES_SYSTEM_TENANT, feesBusinessKey } from '../../src/jobs/queues';
import { createFeesProcessor } from '../../src/modules/fees/fees-processor';
import { voidEndedLines } from '../../src/modules/fees/invoice-generation';
import {
  createDbTestApp,
  Factory,
  ownerDb,
  START,
  type DbTestApp,
  type TenantFixture,
  type UserFixture,
} from './support/db-app';
import { appDb, assertLedgerInvariants, feesOf, lines, scalar } from './support/fees';
import { api, signInStaff } from './support/people';

const MONTH = '2026-10-01';
const FEE = 250_000;
const TICK = FEES_SYSTEM_TENANT;

const session = (tenantId: string, userId: string, roles: string[] = ['owner']) =>
  ({ userId, roles, tenantId }) as unknown as AuthSession;

describe('fee ledger engine (FEE-01, FEE-11) against Postgres', () => {
  let t: DbTestApp;
  let db: Db;
  let f: Factory;
  const fees = () => feesOf(t);

  /** Producer double that records what a tick fans out. */
  const recorder = () => {
    const added: { tenantId: string; kind: string; month?: string }[] = [];
    return {
      added,
      producer: {
        add: async (_queue: string, payload: { tenantId: string; kind: string; month?: string }) => {
          added.push(payload);
          return { jobId: 'x' };
        },
      },
    };
  };
  const processorFor = (alert: (tenantId: string, ids: string[]) => void = () => undefined) => {
    const r = recorder();
    return { ...r, run: createFeesProcessor(appDb(t), r.producer as never, t.clock, alert) };
  };

  /** A tenant with `n` students, each enrolled in one class from 2026-09 and billed for 2026-10. */
  async function world(n = 1, opts: { fee?: number } = {}) {
    const tenant = await f.tenant('active');
    const staff = await f.staff(tenant, ['owner']);
    const klass = await f.klass(tenant, { name: 'Physics', feeCents: opts.fee ?? FEE });
    const students: UserFixture[] = [];
    for (let i = 0; i < n; i++) {
      const s = await f.student(tenant, { name: `S${i}` });
      await f.enroll(tenant, s.id, klass, { from: '2026-09-01' });
      students.push(s);
    }
    await fees().generateInvoices(tenant.id, '2026-10');
    return { tenant, staff, klass, students };
  }
  const cash = (
    tenant: TenantFixture,
    lineIds: string[],
    amountCents: number,
    key: string,
    receivedBy: string | null = null,
  ) =>
    fees().recordPayment(tenant.id, {
      method: 'cash',
      amountCents,
      lines: lineIds,
      idempotencyKey: key,
      receivedBy,
    });
  const count = (tenantId: string, table: string) =>
    scalar<number>(db, tenantId, sql`select count(*)::int as v from ${sql.identifier(table)}`);

  beforeAll(async () => {
    t = await createDbTestApp();
    db = ownerDb();
    f = new Factory(db);
    t.clock.set(START);
  });
  afterAll(async () => {
    await t.close();
    await db.$client.end();
  });

  describe('invoice generation (FEE-01)', () => {
    it('creates one invoice per student with numbered, snapshotted lines and the due date', async () => {
      const w = await world(2);
      const ls = await lines(db, w.tenant.id);
      expect(ls).toHaveLength(2);
      const inv = await withTenant(
        db,
        w.tenant.id,
        async (tx) =>
          (
            await tx.execute<{ number: string; due_on: string; status: string; month: string }>(
              sql`select number, due_on::text, status::text, month::text from invoices order by number`,
            )
          ).rows,
      );
      expect(inv).toHaveLength(2);
      for (const row of inv) {
        expect(row.number).toMatch(/^TT-I-26-10-TT-[0-9a-f]{6}$/);
        expect(row.due_on).toBe('2026-10-05');
        expect(row.month).toBe(MONTH);
        expect(row.status).toBe('overdue'); // today is 15 October
      }
      expect(ls.every((l) => l.amount_cents === FEE && l.paid === 0)).toBe(true);
    });

    it('is idempotent: running the same month twice (also concurrently) adds nothing', async () => {
      const w = await world(3);
      const before = await lines(db, w.tenant.id);
      await Promise.all([
        fees().generateInvoices(w.tenant.id, '2026-10'),
        fees().generateInvoices(w.tenant.id, '2026-10'),
        fees().generateInvoices(w.tenant.id, MONTH),
      ]);
      expect(await lines(db, w.tenant.id)).toEqual(before);
      expect(await count(w.tenant.id, 'invoices')).toBe(3);
    });

    it('snapshots the fee override and leaves out ended, future and archived enrolments', async () => {
      const tenant = await f.tenant('active');
      const klass = await f.klass(tenant, { name: 'Chem', feeCents: FEE });
      const archivedClass = await f.klass(tenant, { name: 'Old', feeCents: FEE, archived: true });
      const discounted = await f.student(tenant);
      const ended = await f.student(tenant);
      const future = await f.student(tenant);
      const archived = await f.student(tenant, { archived: true });
      const inArchivedClass = await f.student(tenant);
      await f.enroll(tenant, discounted.id, klass, { from: '2026-01-01', feeOverrideCents: 100_000 });
      await f.enroll(tenant, ended.id, klass, { from: '2026-01-01', to: '2026-09-01' });
      await f.enroll(tenant, future.id, klass, { from: '2026-11-01' });
      await f.enroll(tenant, archived.id, klass, { from: '2026-01-01' });
      await f.enroll(tenant, inArchivedClass.id, archivedClass, { from: '2026-01-01' });
      expect(await fees().generateInvoices(tenant.id, '2026-10')).toBe(1);
      const ls = await lines(db, tenant.id);
      expect(ls.map((l) => [l.student_id, l.amount_cents])).toEqual([[discounted.id, 100_000]]);
      // A later fee change never rewrites the snapshot.
      await db.update(schema.classes).set({ feeCents: 1 }).where(eq(schema.classes.id, klass));
      await fees().generateInvoices(tenant.id, '2026-10');
      expect((await lines(db, tenant.id))[0]?.amount_cents).toBe(100_000);
    });

    it('rejects a malformed month', async () => {
      const w = await world(1);
      await expect(fees().generateInvoices(w.tenant.id, '2026-13')).rejects.toThrow();
      await expect(fees().generateInvoices(w.tenant.id, '2026-10-17')).rejects.toThrow();
    });

    it('a free class line is paid without any payment', async () => {
      const w = await world(1, { fee: 0 });
      const [l] = await lines(db, w.tenant.id);
      expect(
        await fees().canAccess(w.tenant.id, l?.student_id ?? '', l?.class_id ?? '', MONTH),
      ).toBe(true);
      expect(await scalar<string>(db, w.tenant.id, sql`select status::text as v from invoices`)).toBe(
        'paid',
      );
    });

    it('enrolling through the API bills the current month at once; moving voids the unpaid old line', async () => {
      const tenant = await f.tenant('active');
      const staff = await f.staff(tenant, ['owner']);
      const klass = await f.klass(tenant, { name: 'Hook', feeCents: FEE });
      const other = await f.klass(tenant, { name: 'Hook 2', feeCents: 100_000 });
      const s = await f.student(tenant);
      const http = api(t, tenant.host, await signInStaff(t, tenant, staff));
      const res = await http.post(`/api/v1/admin/classes/${klass}/enrollments`, {
        studentIds: [s.id],
        fromMonth: '2026-09-01',
      });
      expect(res.status).toBe(201);
      const first = await lines(db, tenant.id);
      expect(first.map((l) => [l.month, l.amount_cents, l.class_id])).toEqual([[MONTH, FEE, klass]]);
      const [enrollment] = await db
        .select()
        .from(schema.enrollments)
        .where(eq(schema.enrollments.studentId, s.id));
      const moved = await http.post(`/api/v1/admin/enrollments/${enrollment!.id}/move`, {
        toClassId: other,
        fromMonth: '2026-10-01',
      });
      expect(moved.status).toBe(200);
      // The old enrolment now ends in September, so its unpaid October line is voided.
      const afterMove = await lines(db, tenant.id);
      expect(afterMove.map((l) => [l.class_id, l.voided, l.amount_cents]).sort()).toEqual(
        [
          [klass, true, FEE],
          [other, false, 100_000],
        ].sort(),
      );
      await assertLedgerInvariants(db, t, tenant);
    });
  });

  describe('recordPayment (ADR 0008 §4)', () => {
    it('cash exactly covering the line pays it, writes a receipt and an audit row, and unlocks the month', async () => {
      const w = await world(1);
      const [l] = await lines(db, w.tenant.id);
      const s = w.students[0]!;
      expect(await fees().canAccess(w.tenant.id, s.id, l!.class_id, MONTH)).toBe(false);
      const r = await cash(w.tenant, [l!.id], FEE, 'k1', w.staff.id);
      expect(r.receiptNumber).toBe('TT-R-26-00001');
      expect(r.payment).toMatchObject({
        method: 'cash',
        amountCents: FEE,
        unallocatedCents: 0,
        needsRefund: false,
      });
      expect(await fees().canAccess(w.tenant.id, s.id, l!.class_id, MONTH)).toBe(true);
      expect(await scalar<string>(db, w.tenant.id, sql`select status::text as v from invoices`)).toBe(
        'paid',
      );
      expect(
        await scalar<number>(db, w.tenant.id, sql`select paid_cents::float8 as v from invoices`),
      ).toBe(FEE);
      const audits = await f.audits(w.tenant, 'payment.record');
      expect(audits).toHaveLength(1);
      expect(audits[0]).toMatchObject({
        entity: 'payment',
        entityId: r.payment.id,
        actorId: w.staff.id,
      });
      await assertLedgerInvariants(db, t, w.tenant);
    });

    it('cash and manual must cover the open balance exactly and write nothing otherwise', async () => {
      const w = await world(1);
      const [l] = await lines(db, w.tenant.id);
      for (const amount of [FEE - 1, FEE + 1, 0]) {
        await expect(cash(w.tenant, [l!.id], amount, `bad-${amount}`)).rejects.toMatchObject({
          status: 409,
        });
      }
      await expect(
        fees().recordPayment(w.tenant.id, {
          method: 'manual',
          amountCents: 5,
          lines: [l!.id],
          idempotencyKey: 'm',
          receivedBy: null,
        }),
      ).rejects.toBeInstanceOf(AppException);
      expect(await count(w.tenant.id, 'payments')).toBe(0);
      expect(await count(w.tenant.id, 'receipts')).toBe(0);
    });

    it('card allocates oldest month first, never over-allocates and flags surplus for refund', async () => {
      const w = await world(1);
      await fees().generateInvoices(w.tenant.id, '2026-11');
      await fees().generateInvoices(w.tenant.id, '2026-12');
      const ls = await lines(db, w.tenant.id);
      expect(ls.map((l) => l.month)).toEqual(['2026-10-01', '2026-11-01', '2026-12-01']);
      // Lines passed newest-first: allocation is still oldest month first.
      const r = await fees().recordPayment(w.tenant.id, {
        method: 'card',
        amountCents: FEE * 2 + 5_000,
        lines: [...ls].reverse().map((l) => l.id),
        idempotencyKey: 'card-1',
        receivedBy: null,
        providerRef: 'PH-1',
      });
      expect((await lines(db, w.tenant.id)).map((l) => l.paid)).toEqual([FEE, FEE, 5_000]);
      expect(r.payment).toMatchObject({
        unallocatedCents: 0,
        needsRefund: false,
        providerRef: 'PH-1',
      });
      // Underpaying fills what it can and leaves the rest open.
      const r2 = await fees().recordPayment(w.tenant.id, {
        method: 'card',
        amountCents: 100,
        lines: [ls[2]!.id],
        idempotencyKey: 'card-2',
        receivedBy: null,
      });
      expect(r2.payment.unallocatedCents).toBe(0);
      expect((await lines(db, w.tenant.id)).map((l) => l.paid)).toEqual([FEE, FEE, 5_100]);
      // Paying more than the open balance leaves the excess unallocated for the owner to refund.
      const r4 = await fees().recordPayment(w.tenant.id, {
        method: 'card',
        amountCents: FEE,
        lines: [ls[2]!.id],
        idempotencyKey: 'card-4',
        receivedBy: null,
      });
      expect(r4.payment).toMatchObject({ unallocatedCents: 5_100, needsRefund: true });
      expect((await lines(db, w.tenant.id)).map((l) => l.paid)).toEqual([FEE, FEE, FEE]);
      // Paying an already-paid line: everything is surplus, nothing leaks to other months.
      const r3 = await fees().recordPayment(w.tenant.id, {
        method: 'card',
        amountCents: FEE,
        lines: [ls[0]!.id],
        idempotencyKey: 'card-3',
        receivedBy: null,
      });
      expect(r3.payment).toMatchObject({ unallocatedCents: FEE, needsRefund: true });
      expect((await lines(db, w.tenant.id)).map((l) => l.paid)).toEqual([FEE, FEE, FEE]);
      await assertLedgerInvariants(db, t, w.tenant);
    });

    it('rejects lines of several students, of another tenant, unknown lines and an empty selection', async () => {
      const w = await world(2);
      const other = await world(1);
      const ls = await lines(db, w.tenant.id);
      const foreign = await lines(db, other.tenant.id);
      await expect(
        cash(w.tenant, ls.map((l) => l.id), FEE * 2, 'two'),
      ).rejects.toMatchObject({ status: 404 });
      await expect(cash(w.tenant, [foreign[0]!.id], FEE, 'foreign')).rejects.toMatchObject({
        status: 404,
      });
      await expect(
        cash(w.tenant, ['0193f1c2-7b1d-7c3e-9a4f-000000000999'], FEE, 'ghost'),
      ).rejects.toMatchObject({ status: 404 });
      await expect(cash(w.tenant, [], 0, 'empty')).rejects.toMatchObject({ status: 400 });
      expect(await count(w.tenant.id, 'payments')).toBe(0);
      expect(await count(other.tenant.id, 'payments')).toBe(0);
    });

    it('same idempotency key: a sequential retry returns the same payment and receipt', async () => {
      const w = await world(1);
      const [l] = await lines(db, w.tenant.id);
      const first = await cash(w.tenant, [l!.id], FEE, 'retry-me');
      const again = await cash(w.tenant, [l!.id], FEE, 'retry-me');
      expect(again.payment.id).toBe(first.payment.id);
      expect(again.receiptNumber).toBe(first.receiptNumber);
      expect(again.replayed).toBe(true);
      expect(await count(w.tenant.id, 'payments')).toBe(1);
      expect(await count(w.tenant.id, 'receipts')).toBe(1);
      expect(await count(w.tenant.id, 'payment_allocations')).toBe(1);
    });

    it('same idempotency key fired concurrently: one payment, one receipt, one audit row, one hook', async () => {
      const w = await world(1);
      const [l] = await lines(db, w.tenant.id);
      const events: string[] = [];
      fees()['hooks'].registerPaymentCommitted(async (e) => {
        if (e.tenantId === w.tenant.id) events.push(e.paymentId);
      });
      const results = await Promise.all(
        Array.from({ length: 10 }, () => cash(w.tenant, [l!.id], FEE, 'parallel')),
      );
      expect(new Set(results.map((r) => r.payment.id)).size).toBe(1);
      expect(new Set(results.map((r) => r.receiptNumber)).size).toBe(1);
      expect(results.filter((r) => !r.replayed)).toHaveLength(1);
      expect(await count(w.tenant.id, 'payments')).toBe(1);
      expect(await count(w.tenant.id, 'receipts')).toBe(1);
      expect(await f.audits(w.tenant, 'payment.record')).toHaveLength(1);
      expect(events).toEqual([results[0]!.payment.id]);
    });

    it('concurrent card payments on the same line can never over-allocate it', async () => {
      const w = await world(1);
      const [l] = await lines(db, w.tenant.id);
      const results = await Promise.all(
        Array.from({ length: 12 }, (_, i) =>
          fees().recordPayment(w.tenant.id, {
            method: 'card',
            amountCents: 100_000,
            lines: [l!.id],
            idempotencyKey: `race-${i}`,
            receivedBy: null,
          }),
        ),
      );
      const [after] = await lines(db, w.tenant.id);
      expect(after!.paid).toBe(FEE);
      expect(results.reduce((n, r) => n + r.payment.unallocatedCents, 0)).toBe(12 * 100_000 - FEE);
      await assertLedgerInvariants(db, t, w.tenant);
    });

    it('concurrent cash payments for the same line: exactly one wins, the others conflict', async () => {
      const w = await world(1);
      const [l] = await lines(db, w.tenant.id);
      const settled = await Promise.allSettled(
        Array.from({ length: 6 }, (_, i) => cash(w.tenant, [l!.id], FEE, `cash-race-${i}`)),
      );
      expect(settled.filter((s) => s.status === 'fulfilled')).toHaveLength(1);
      for (const s of settled) {
        if (s.status === 'rejected') expect(s.reason).toMatchObject({ status: 409 });
      }
      expect((await lines(db, w.tenant.id))[0]!.paid).toBe(FEE);
    });

    it('receipt numbers are gap-free and sequential under concurrency, per tenant', async () => {
      const n = 25;
      const w = await world(n);
      const ls = await lines(db, w.tenant.id);
      await Promise.all(ls.map((l, i) => cash(w.tenant, [l.id], FEE, `rc-${i}`)));
      const numbers = (
        await withTenant(
          db,
          w.tenant.id,
          async (tx) =>
            (await tx.execute<{ number: string }>(sql`select number from receipts order by number`))
              .rows,
        )
      ).map((r) => r.number);
      expect(numbers).toEqual(
        Array.from({ length: n }, (_, i) => `TT-R-26-${String(i + 1).padStart(5, '0')}`),
      );
      const w2 = await world(1);
      const [l2] = await lines(db, w2.tenant.id);
      expect((await cash(w2.tenant, [l2!.id], FEE, 'x')).receiptNumber).toBe('TT-R-26-00001');
    });

    it('a failed payment leaves no receipt-number hole (the counter rolls back with it)', async () => {
      const w = await world(2);
      const ls = await lines(db, w.tenant.id);
      await expect(cash(w.tenant, [ls[0]!.id], FEE - 1, 'bad')).rejects.toBeTruthy();
      expect((await cash(w.tenant, [ls[0]!.id], FEE, 'good1')).receiptNumber).toBe('TT-R-26-00001');
      expect((await cash(w.tenant, [ls[1]!.id], FEE, 'good2')).receiptNumber).toBe('TT-R-26-00002');
    });

    it('a cash receipt keeps the cash handed over and refuses less than the amount', async () => {
      const w = await world(1);
      const [l] = await lines(db, w.tenant.id);
      await expect(
        fees().recordPayment(w.tenant.id, {
          method: 'cash',
          amountCents: FEE,
          lines: [l!.id],
          idempotencyKey: 'short',
          receivedBy: null,
          cashReceivedCents: FEE - 1,
        }),
      ).rejects.toMatchObject({ status: 409 });
      const r = await fees().recordPayment(w.tenant.id, {
        method: 'cash',
        amountCents: FEE,
        lines: [l!.id],
        idempotencyKey: 'ok',
        receivedBy: null,
        cashReceivedCents: FEE + 50_000,
      });
      const receipt = await fees().getReceipt(w.tenant.id, r.receiptId!);
      expect(receipt).toMatchObject({
        cashReceivedCents: FEE + 50_000,
        changeCents: 50_000,
        number: r.receiptNumber,
      });
    });
  });

  describe('reversePayment (ADR 0008 §7)', () => {
    it('restores the exact prior paid state, re-locks the month and marks the receipt', async () => {
      const w = await world(1);
      await fees().generateInvoices(w.tenant.id, '2026-11');
      const ls = await lines(db, w.tenant.id);
      const before = await lines(db, w.tenant.id);
      const summary = sql`select string_agg(status::text || ':' || paid_cents::text, ',' order by month) as v from invoices`;
      const statusBefore = await scalar<string>(db, w.tenant.id, summary);
      const p = await cash(w.tenant, [ls[0]!.id], FEE, 'to-reverse', w.staff.id);
      expect(await fees().canAccess(w.tenant.id, w.students[0]!.id, ls[0]!.class_id, MONTH)).toBe(
        true,
      );
      const reversal = await fees().reversePayment(
        w.tenant.id,
        session(w.tenant.id, w.staff.id),
        p.payment.id,
        'Entered by mistake',
      );
      expect(reversal).toMatchObject({
        method: 'reversal',
        amountCents: -FEE,
        reversesPaymentId: p.payment.id,
        receiptId: null,
      });
      expect(await lines(db, w.tenant.id)).toEqual(before);
      expect(await scalar<string>(db, w.tenant.id, summary)).toBe(statusBefore);
      expect(await fees().canAccess(w.tenant.id, w.students[0]!.id, ls[0]!.class_id, MONTH)).toBe(
        false,
      );
      expect(
        await scalar<boolean>(db, w.tenant.id, sql`select reversed_at is not null as v from receipts`),
      ).toBe(true);
      expect((await fees().getPayment(w.tenant.id, p.payment.id)).reversedByPaymentId).toBe(
        reversal.id,
      );
      const audits = await f.audits(w.tenant, 'payment.reverse');
      expect(audits).toHaveLength(1);
      expect(audits[0]).toMatchObject({
        actorId: w.staff.id,
        after: { reversesPaymentId: p.payment.id, reason: 'Entered by mistake' },
      });
      await assertLedgerInvariants(db, t, w.tenant);
      // The month can be paid again with a new payment.
      await cash(w.tenant, [ls[0]!.id], FEE, 'again');
      expect(await fees().canAccess(w.tenant.id, w.students[0]!.id, ls[0]!.class_id, MONTH)).toBe(
        true,
      );
    });

    it('can happen once: concurrent attempts conflict and a reversal cannot be reversed', async () => {
      const w = await world(1);
      const [l] = await lines(db, w.tenant.id);
      const p = await cash(w.tenant, [l!.id], FEE, 'once');
      const settled = await Promise.allSettled(
        Array.from({ length: 5 }, () =>
          fees().reversePayment(
            w.tenant.id,
            session(w.tenant.id, w.staff.id),
            p.payment.id,
            'Duplicate click',
          ),
        ),
      );
      const ok = settled.filter((s) => s.status === 'fulfilled');
      expect(ok).toHaveLength(1);
      for (const s of settled) {
        if (s.status === 'rejected') expect(s.reason).toMatchObject({ status: 409 });
      }
      const reversalId = (ok[0] as PromiseFulfilledResult<{ id: string }>).value.id;
      await expect(
        fees().reversePayment(
          w.tenant.id,
          session(w.tenant.id, w.staff.id),
          reversalId,
          'Reverse the reversal',
        ),
      ).rejects.toMatchObject({ status: 409 });
      expect(
        await scalar<number>(
          db,
          w.tenant.id,
          sql`select count(*)::int as v from payments where method = 'reversal'`,
        ),
      ).toBe(1);
    });

    it('needs a reason, an owner and an existing payment of this tenant', async () => {
      const w = await world(1);
      const other = await world(1);
      const [l] = await lines(db, w.tenant.id);
      const p = await cash(w.tenant, [l!.id], FEE, 'perm');
      await expect(
        fees().reversePayment(w.tenant.id, session(w.tenant.id, w.staff.id), p.payment.id, '  '),
      ).rejects.toMatchObject({ status: 400 });
      await expect(
        fees().reversePayment(
          w.tenant.id,
          session(w.tenant.id, w.staff.id, ['admin']),
          p.payment.id,
          'Not allowed',
        ),
      ).rejects.toMatchObject({ status: 403 });
      await expect(
        fees().reversePayment(
          other.tenant.id,
          session(other.tenant.id, other.staff.id),
          p.payment.id,
          'Cross tenant',
        ),
      ).rejects.toMatchObject({ status: 404 });
      expect(
        await scalar<number>(
          db,
          w.tenant.id,
          sql`select count(*)::int as v from payments where method = 'reversal'`,
        ),
      ).toBe(0);
    });

    it('reversing a card payment with surplus clears its refund flag in reads', async () => {
      const w = await world(1);
      const [l] = await lines(db, w.tenant.id);
      const p = await fees().recordPayment(w.tenant.id, {
        method: 'card',
        amountCents: FEE + 7_000,
        lines: [l!.id],
        idempotencyKey: 'card-surplus',
        receivedBy: null,
      });
      expect(p.payment.needsRefund).toBe(true);
      await fees().reversePayment(
        w.tenant.id,
        session(w.tenant.id, w.staff.id),
        p.payment.id,
        'Refunded in PayHere',
      );
      expect((await fees().getPayment(w.tenant.id, p.payment.id)).needsRefund).toBe(false);
      await assertLedgerInvariants(db, t, w.tenant);
    });
  });

  describe('voiding (ADR 0008 §8)', () => {
    it('voids the unpaid line of an ended enrolment but never a paid one', async () => {
      const tenant = await f.tenant('active');
      const klass = await f.klass(tenant, { name: 'Phys', feeCents: FEE });
      const paidStudent = await f.student(tenant);
      const unpaidStudent = await f.student(tenant);
      await f.enroll(tenant, paidStudent.id, klass, { from: '2026-09-01' });
      await f.enroll(tenant, unpaidStudent.id, klass, { from: '2026-09-01' });
      await fees().generateInvoices(tenant.id, '2026-10');
      const paidLine = (await lines(db, tenant.id)).find((l) => l.student_id === paidStudent.id)!;
      await cash(tenant, [paidLine.id], FEE, 'paid');
      const enrollments = await db
        .select()
        .from(schema.enrollments)
        .where(eq(schema.enrollments.tenantId, tenant.id));
      await db
        .update(schema.enrollments)
        .set({ toMonth: '2026-09-01' })
        .where(eq(schema.enrollments.tenantId, tenant.id));
      const voided = await withTenant(appDb(t), tenant.id, (tx) =>
        voidEndedLines(tx, enrollments.map((e) => e.id), 'Enrolment ended', t.clock.now()),
      );
      expect(voided).toBe(1);
      const after = await lines(db, tenant.id);
      expect(after.find((l) => l.student_id === unpaidStudent.id)?.voided).toBe(true);
      expect(after.find((l) => l.student_id === paidStudent.id)?.voided).toBe(false);
      expect(await fees().canAccess(tenant.id, unpaidStudent.id, klass, MONTH)).toBe(false);
      // A voided line takes no more money.
      const voidedLine = after.find((l) => l.voided)!;
      await expect(cash(tenant, [voidedLine.id], 0, 'void-pay')).rejects.toMatchObject({
        status: 409,
      });
      await assertLedgerInvariants(db, t, tenant);
    });
  });

  describe('Asia/Colombo month boundaries', () => {
    afterAll(() => t.clock.set(START));

    it('the monthly tick bills the Colombo month: 23:59:59 on 31 Oct is October, midnight is November', async () => {
      const w = await world(1);
      const p = processorFor();
      t.clock.set(new Date('2026-10-31T18:29:59Z'));
      await p.run({ kind: 'monthly_tick', tenantId: TICK }, {} as never);
      expect(p.added.find((a) => a.tenantId === w.tenant.id)).toEqual({
        kind: 'invoices',
        tenantId: w.tenant.id,
        month: '2026-10',
      });
      p.added.length = 0;
      t.clock.set(new Date('2026-10-31T18:30:00Z'));
      await p.run({ kind: 'monthly_tick', tenantId: TICK }, {} as never);
      expect(p.added.find((a) => a.tenantId === w.tenant.id)?.month).toBe('2026-11');
    });

    it('enrolling at 23:30 UTC on the last day of a month bills the next month (Colombo is already there)', async () => {
      const tenant = await f.tenant('active');
      const staff = await f.staff(tenant, ['owner']);
      const klass = await f.klass(tenant, { name: 'Edge', feeCents: FEE });
      const s = await f.student(tenant);
      t.clock.set(new Date('2026-10-31T23:30:00Z'));
      const http = api(t, tenant.host, await signInStaff(t, tenant, staff));
      const res = await http.post(`/api/v1/admin/classes/${klass}/enrollments`, {
        studentIds: [s.id],
        fromMonth: '2026-11-01',
      });
      expect(res.status).toBe(201);
      const ls = await lines(db, tenant.id);
      expect(ls.map((l) => l.month)).toEqual(['2026-11-01']);
      expect(await scalar<string>(db, tenant.id, sql`select due_on::text as v from invoices`)).toBe(
        '2026-11-05',
      );
    });

    it('overdue starts at midnight on the day after the due date in Colombo, not in UTC', async () => {
      const w = await world(1);
      const status = () =>
        scalar<string>(db, w.tenant.id, sql`select status::text as v from invoices`);
      const p = processorFor();
      const recompute = () =>
        p.run({ kind: 'recompute', tenantId: w.tenant.id, date: '2026-10-05' }, {} as never);
      t.clock.set(new Date('2026-10-05T18:29:59Z')); // 23:59:59 on the due day
      await recompute();
      expect(await status()).toBe('unpaid');
      t.clock.set(new Date('2026-10-05T18:30:00Z')); // 00:00 on the 6th
      await recompute();
      expect(await status()).toBe('overdue');
    });

    it('receipt numbers restart on 1 January Colombo time, not UTC', async () => {
      const w = await world(2);
      const [a, b] = await lines(db, w.tenant.id);
      t.clock.set(new Date('2026-12-31T18:29:59Z'));
      expect((await cash(w.tenant, [a!.id], FEE, 'ny-1')).receiptNumber).toBe('TT-R-26-00001');
      t.clock.set(new Date('2026-12-31T18:30:00Z'));
      expect((await cash(w.tenant, [b!.id], FEE, 'ny-2')).receiptNumber).toBe('TT-R-27-00001');
    });
  });

  describe('invoice job (ADR 0012)', () => {
    it('fans out one job per tenant keyed by tenant and month; running it twice changes nothing', async () => {
      const w = await world(3);
      const p = processorFor();
      await p.run({ kind: 'monthly_tick', tenantId: TICK }, {} as never);
      const mine = p.added.filter((a) => a.tenantId === w.tenant.id);
      expect(mine).toEqual([{ kind: 'invoices', tenantId: w.tenant.id, month: '2026-10' }]);
      expect(feesBusinessKey(mine[0] as never)).toBe(`invoices:${w.tenant.id}:2026-10`);
      const before = await lines(db, w.tenant.id);
      await p.run(mine[0] as never, {} as never);
      await p.run(mine[0] as never, {} as never);
      expect(await lines(db, w.tenant.id)).toEqual(before);
      expect(await count(w.tenant.id, 'invoices')).toBe(3);
    });

    it('a suspended tenant is not billed by the tick', async () => {
      const suspended = await f.tenant('suspended');
      const p = processorFor();
      await p.run({ kind: 'monthly_tick', tenantId: TICK }, {} as never);
      expect(p.added.some((a) => a.tenantId === suspended.id)).toBe(false);
    });

    it('the nightly recompute repairs a drifted projection and reports it once', async () => {
      const w = await world(1);
      const [l] = await lines(db, w.tenant.id);
      await cash(w.tenant, [l!.id], FEE, 'drift');
      // Corrupt the cache as the app role could (status/paid_cents are its writable invoice columns).
      await withTenant(appDb(t), w.tenant.id, (tx) =>
        tx.execute(sql`update invoices set status = 'unpaid', paid_cents = 0`),
      );
      const alerts: string[][] = [];
      const p = processorFor((_tenant, ids) => alerts.push(ids));
      await p.run({ kind: 'recompute', tenantId: w.tenant.id, date: '2026-10-15' }, {} as never);
      expect(alerts).toHaveLength(1);
      expect(await scalar<string>(db, w.tenant.id, sql`select status::text as v from invoices`)).toBe(
        'paid',
      );
      await p.run({ kind: 'recompute', tenantId: w.tenant.id, date: '2026-10-15' }, {} as never);
      expect(alerts).toHaveLength(1);
    });
  });
});
