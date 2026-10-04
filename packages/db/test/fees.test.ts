import { sql } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import { withTenant } from '../src/tenant';
import { connectAll, expectPgError, rolledBack, Rollback } from './support';
import { createWorld, type World } from './tables';
import { grantViolations } from './catalog';
import { TABLE_NAMES, TABLES } from './tables';

const db = connectAll();
let a: World; let b: World;
beforeAll(async () => { [a,b] = await Promise.all([createWorld(db.owner, 'fees-a'), createWorld(db.owner, 'fees-b')]); });
describe('ADR 0008 database enforcement', () => {
  it('settings insertion defaults to due day 5 and no grace', async () => {
    const w = await createWorld(db.owner, 'settings-control', false);
    const r = await withTenant(db.app, w.tenantId, tx => tx.execute<{ due_day: number; unlock_before_due: boolean }>(sql`insert into tenant_settings (tenant_id) values (${w.tenantId}) returning due_day, unlock_before_due`));
    expect(r.rows).toEqual([{ due_day: 5, unlock_before_due: false }]);
  });
  for (const [table, column] of [['invoices', 'paid_cents'], ['invoice_lines', 'void_reason'], ['receipts', 'pdf_key'], ['tenant_settings', 'due_day']] as const) {
    it(`${table}: state-column update is tenant-bound and identity update is forbidden`, async () => {
      await rolledBack(withTenant(db.app, a.tenantId, async tx => {
        const foreign = await tx.execute(sql`update ${sql.identifier(table)} set ${sql.identifier(column)} = ${sql.identifier(column)} where tenant_id = ${b.tenantId}`);
        expect(foreign.rowCount).toBe(0);
        const own = await tx.execute(sql`update ${sql.identifier(table)} set ${sql.identifier(column)} = ${sql.identifier(column)} where tenant_id = ${a.tenantId}`);
        expect(own.rowCount).toBeGreaterThan(0);
        throw new Rollback();
      }));
      await expectPgError(withTenant(db.app, a.tenantId, tx => tx.execute(sql`update ${sql.identifier(table)} set id = id`)), '42501');
    });
  }
  it('the catalog detects accidentally granting append-only UPDATE or extra state columns', async () => {
    await rolledBack(withTenant(db.owner, a.tenantId, async tx => {
      await tx.execute(sql`grant update on payments to remix_app; grant update (amount_cents) on invoice_lines to remix_app`);
      const problems = await grantViolations(tx, Object.fromEntries(TABLE_NAMES.map(n => [n, TABLES[n].access])));
      expect(problems.some(p => p.includes('payments') && p.includes('UPDATE'))).toBe(true);
      expect(problems.some(p => p.includes('invoice_lines.amount_cents'))).toBe(true);
      throw new Rollback();
    }));
  });
  it('the catalog detects an unforced ledger table', async () => {
    await rolledBack(db.owner.transaction(async tx => {
      await tx.execute(sql`alter table payments no force row level security`);
      expect((await grantViolations(tx, Object.fromEntries(TABLE_NAMES.map(n => [n, TABLES[n].access])))).some(p => p.includes('payments: ledger RLS is not forced'))).toBe(true);
      throw new Rollback();
    }));
  });
  it('payment reversal sign and nonnegative money constraints reject invalid inserts', async () => {
    for (const values of [sql`'cash', -1, null`, sql`'reversal', 1, ${a.paymentId}::uuid`, sql`'reversal', -1, null`]) {
      await expectPgError(withTenant(db.app, a.tenantId, tx => tx.execute(sql`insert into payments (tenant_id, student_id, method, amount_cents, reverses_payment_id, idempotency_key) values (${a.tenantId}, ${a.studentUserId}, ${values}, 'bad-sign')`)), '23514');
    }
    await expectPgError(withTenant(db.app, a.tenantId, tx => tx.execute(sql`insert into payment_allocations (tenant_id, payment_id, invoice_line_id, amount_cents) values (${a.tenantId}, ${a.sparePaymentId}, ${a.lineId}, -1)`)), '23514');
  });
});

describe('ADR 0008 append-only money', () => {
  it.each(['payments', 'payment_allocations'] as const)('%s: the app role can neither UPDATE nor DELETE', async (table) => {
    const t = sql.identifier(table);
    await expectPgError(withTenant(db.app, a.tenantId, (tx) => tx.execute(sql`update ${t} set tenant_id = tenant_id`)), '42501');
    await expectPgError(withTenant(db.app, a.tenantId, (tx) => tx.execute(sql`update ${t} set id = id where tenant_id = ${a.tenantId}`)), '42501');
    await expectPgError(withTenant(db.app, a.tenantId, (tx) => tx.execute(sql`delete from ${t} where tenant_id = ${a.tenantId}`)), '42501');
    await expectPgError(withTenant(db.app, a.tenantId, (tx) => tx.execute(sql`truncate ${t}`)), '42501');
  });
  it('payments cannot be locked FOR UPDATE by the app role (no UPDATE privilege)', async () => {
    await expectPgError(withTenant(db.app, a.tenantId, (tx) => tx.execute(sql`select 1 from payments for update`)), '42501');
  });
});
