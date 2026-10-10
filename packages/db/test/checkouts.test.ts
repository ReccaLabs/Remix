import { sql } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import { withTenant } from '../src/tenant';
import { connectAll, expectPgError, rolledBack, Rollback } from './support';
import { createWorld, type World } from './tables';

/** FEE-04 / SET-02 (ADR 0008 §6): checkout constraints and lifecycle beyond the isolation suite. */
const db = connectAll();
let a: World;
let b: World;
beforeAll(async () => {
  [a, b] = await Promise.all([createWorld(db.owner, 'checkout-a'), createWorld(db.owner, 'checkout-b')]);
});

const app = <T>(w: World, work: Parameters<typeof withTenant<T>>[2]) => withTenant(db.app, w.tenantId, work);
const update = (w: World, set: ReturnType<typeof sql>, id = w.checkoutId) =>
  app(w, (tx) => tx.execute(sql`update payhere_checkouts set ${set} where id = ${id}::uuid`));
const paid = (w: World, paymentId = w.sparePaymentId) =>
  sql`status = 'paid', provider_payment_id = 'PH-1', payment_id = ${paymentId}::uuid, status_code = 2, notified_at = now()`;

describe('payhere_checkouts', () => {
  it('pins currency, mode, merchant format, amount and the kind shape', async () => {
    const insert = (values: ReturnType<typeof sql>) =>
      app(a, (tx) =>
        tx.execute(sql`insert into payhere_checkouts (tenant_id, kind, student_id, created_by, amount_cents, currency, merchant_id, mode, expires_at)
          values ${values}`),
      );
    const row = (o: Partial<Record<'kind' | 'student' | 'by' | 'amount' | 'currency' | 'merchant' | 'mode', unknown>> = {}) =>
      sql`(${a.tenantId}::uuid, ${o.kind ?? 'fees'}::checkout_kind, ${o.student === undefined ? a.studentUserId : o.student}::uuid,
        ${o.by ?? a.studentUserId}::uuid, ${o.amount ?? 1000}, ${o.currency ?? 'LKR'}, ${o.merchant ?? '1211149'}, ${o.mode ?? 'sandbox'}, now() + interval '30 minutes')`;
    await rolledBack(
      app(a, async (tx) => {
        await tx.execute(sql`insert into payhere_checkouts (tenant_id, kind, student_id, created_by, amount_cents, merchant_id, mode, expires_at)
          values (${a.tenantId}::uuid, 'test', null, ${a.staffUserId}::uuid, 1000, '1211149', 'live', now() + interval '30 minutes')`);
        throw new Rollback();
      }),
    );
    for (const bad of [
      row({ currency: 'USD' }),
      row({ mode: 'prod' }),
      row({ merchant: 'M-1' }),
      row({ amount: 0 }),
      row({ by: a.staffUserId }),
      row({ student: null }),
      row({ kind: 'test' }),
    ])
      await expectPgError(insert(bad), '23514');
    await expectPgError(
      app(a, (tx) =>
        tx.execute(sql`insert into payhere_checkouts (tenant_id, kind, student_id, created_by, amount_cents, merchant_id, mode, created_at, expires_at)
          values (${a.tenantId}::uuid, 'fees', ${a.studentUserId}::uuid, ${a.studentUserId}::uuid, 1000, '1211149', 'sandbox', now(), now())`),
      ),
      '23514',
    );
  });

  it('cannot be inserted with a state, and identity columns are not updatable', async () => {
    await expectPgError(
      app(a, (tx) =>
        tx.execute(sql`insert into payhere_checkouts (tenant_id, kind, student_id, created_by, amount_cents, merchant_id, mode, expires_at, status)
          values (${a.tenantId}::uuid, 'fees', ${a.studentUserId}::uuid, ${a.studentUserId}::uuid, 1000, '1211149', 'sandbox', now() + interval '1 hour', 'paid')`),
      ),
      '42501',
    );
    for (const set of [
      sql`amount_cents = 1`,
      sql`merchant_id = '9999'`,
      sql`mode = 'live'`,
      sql`student_id = null`,
      sql`expires_at = now() + interval '1 day'`,
      sql`kind = 'test'`,
    ])
      await expectPgError(update(a, set), '42501');
  });

  it('moves one way: paid is final and its payment details are frozen', async () => {
    await rolledBack(
      app(a, async (tx) => {
        // Each statement in its own savepoint, so an expected error does not abort the rest.
        const set = (s: ReturnType<typeof sql>) =>
          tx.transaction((sp) => sp.execute(sql`update payhere_checkouts set ${s} where id = ${a.checkoutId}::uuid`));
        await set(sql`status = 'expired'`);
        await expectPgError(set(sql`status = 'pending'`), '23514');
        await set(sql`status = 'failed', status_code = -2, notified_at = now()`);
        // A late success after expiry or failure: the money was taken, so it is recorded.
        await set(paid(a));
        await expectPgError(set(sql`status = 'cancelled'`), '23514');
        await expectPgError(set(sql`provider_payment_id = 'PH-2'`), '23514');
        await expectPgError(set(sql`payment_id = ${a.paymentId}::uuid`), '23514');
        await set(sql`chargeback_at = now(), status_code = -3`);
        await expectPgError(set(sql`chargeback_at = null`), '23514');
        throw new Rollback();
      }),
    );
  });

  it('keeps paid, the PayHere id, the ledger payment and the chargeback flag consistent', async () => {
    await expectPgError(update(a, sql`status = 'paid'`), '23514');
    await expectPgError(update(a, sql`status = 'paid', provider_payment_id = 'PH-1'`), '23514');
    await expectPgError(update(a, sql`chargeback_at = now()`), '23514');
    await expectPgError(update(a, sql`status_code = 0`), '23514');
    await expectPgError(update(a, sql`status_code = 5, notified_at = now()`), '23514');
    // A tenant-B payment id is rejected by the composite foreign key.
    await expectPgError(update(a, paid(a, b.sparePaymentId)), '23503');
  });
});

describe('payhere_checkout_lines', () => {
  it('only links lines of the checkout’s own student, and never to a test checkout', async () => {
    const otherStudentLine = await withTenant(db.owner, a.tenantId, async (tx) => {
      const user = (await tx.execute<{ id: string }>(sql`insert into tenant_users (tenant_id, kind, phone, display_name, status)
        values (${a.tenantId}::uuid, 'student', '+94770009999', 'Other', 'invited') returning id`)).rows[0]!;
      await tx.execute(sql`insert into students (tenant_id, user_id, student_no) values (${a.tenantId}::uuid, ${user.id}::uuid, 'IS-0777')`);
      const invoice = (await tx.execute<{ id: string }>(sql`insert into invoices (tenant_id, student_id, number, month, due_on)
        values (${a.tenantId}::uuid, ${user.id}::uuid, 'IS-I-26-09-IS-0777', '2026-09-01', '2026-09-05') returning id`)).rows[0]!;
      const enrollment = (await tx.execute<{ id: string }>(sql`insert into enrollments (tenant_id, student_id, class_id, from_month)
        values (${a.tenantId}::uuid, ${user.id}::uuid, ${a.classId}::uuid, '2026-09-01') returning id`)).rows[0]!;
      return (await tx.execute<{ id: string }>(sql`insert into invoice_lines (tenant_id, invoice_id, enrollment_id, class_id, month, amount_cents)
        values (${a.tenantId}::uuid, ${invoice.id}::uuid, ${enrollment.id}::uuid, ${a.classId}::uuid, '2026-09-01', 1000) returning id`)).rows[0]!.id;
    });
    await expectPgError(
      app(a, (tx) =>
        tx.execute(sql`insert into payhere_checkout_lines (tenant_id, checkout_id, invoice_line_id)
          values (${a.tenantId}::uuid, ${a.spareCheckoutId}::uuid, ${otherStudentLine}::uuid)`),
      ),
      '23514',
    );
    const testCheckout = await app(a, async (tx) =>
      (await tx.execute<{ id: string }>(sql`insert into payhere_checkouts (tenant_id, kind, student_id, created_by, amount_cents, merchant_id, mode, expires_at)
        values (${a.tenantId}::uuid, 'test', null, ${a.staffUserId}::uuid, 1000, '1211149', 'sandbox', now() + interval '1 hour') returning id`)).rows[0]!.id,
    );
    await expectPgError(
      app(a, (tx) =>
        tx.execute(sql`insert into payhere_checkout_lines (tenant_id, checkout_id, invoice_line_id)
          values (${a.tenantId}::uuid, ${testCheckout}::uuid, ${a.lineId}::uuid)`),
      ),
      '23514',
    );
    expect(testCheckout).toBeTruthy();
  });
});
