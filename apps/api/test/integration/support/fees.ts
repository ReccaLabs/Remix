import { sql } from 'drizzle-orm';
import { withTenant, type Db } from '@remix/db';
import { DB } from '../../../src/modules/db/db.module';
import { FeesService } from '../../../src/modules/fees/fees.service';
import { freshProjections } from '../../../src/modules/fees/projections';
import type { DbTestApp, TenantFixture } from './db-app';

export function feesOf(t: DbTestApp): FeesService {
  return t.app.get(FeesService);
}
export function appDb(t: DbTestApp): Db {
  return t.app.get<Db>(DB);
}

export type LineRow = {
  id: string; invoice_id: string; enrollment_id: string; class_id: string; month: string;
  amount_cents: number; voided: boolean; paid: number; student_id: string;
};

/** Reads through the owner pool; FORCE RLS makes even that need a tenant context. */
export function lines(db: Db, tenantId: string, where = sql`true`): Promise<LineRow[]> {
  return withTenant(db, tenantId, async (tx) =>
    (await tx.execute<LineRow>(sql`select l.id, l.invoice_id, l.enrollment_id, l.class_id, l.month::text, l.amount_cents::float8 as amount_cents,
      l.voided_at is not null as voided, i.student_id,
      coalesce((select sum(a.amount_cents) from payment_allocations a where a.invoice_line_id = l.id), 0)::float8 as paid
      from invoice_lines l join invoices i on i.id = l.invoice_id where ${where} order by l.month, l.id`)).rows,
  );
}

export async function scalar<T>(db: Db, tenantId: string, query: ReturnType<typeof sql>): Promise<T> {
  const rows = await withTenant(db, tenantId, async (tx) => (await tx.execute<{ v: T }>(query)).rows);
  return rows[0]?.v as T;
}

/**
 * The ledger invariants of ADR 0008 §2, §4, §7, read straight from the tables. Throws on the
 * first violation so a property run reports a shrinkable failure.
 */
export async function assertLedgerInvariants(db: Db, t: DbTestApp, tenant: TenantFixture): Promise<void> {
  const tenantId = tenant.id;
  await withTenant(db, tenantId, async (tx) => {
    const bad = async (label: string, query: ReturnType<typeof sql>) => {
      const rows = (await tx.execute(query)).rows;
      if (rows.length) throw new Error(`${label}: ${JSON.stringify(rows.slice(0, 3))}`);
    };
    await bad('line allocations outside [0, amount]', sql`
      select l.id, s.paid, l.amount_cents from invoice_lines l
      join (select invoice_line_id, sum(amount_cents) paid from payment_allocations group by 1) s on s.invoice_line_id = l.id
      where s.paid < 0 or s.paid > l.amount_cents`);
    await bad('payment allocations exceed the payment', sql`
      select p.id from payments p left join (select payment_id, sum(amount_cents) a from payment_allocations group by 1) s on s.payment_id = p.id
      where p.method <> 'reversal' and coalesce(s.a, 0) > p.amount_cents`);
    await bad('money in != allocations + unallocated (per payment)', sql`
      select p.id from payments p left join (select payment_id, sum(amount_cents) a from payment_allocations group by 1) s on s.payment_id = p.id
      where p.method <> 'reversal' and p.amount_cents <> coalesce(s.a, 0) + p.unallocated_cents`);
    await bad('reversal does not mirror its original', sql`
      select r.id from payments r join payments o on o.id = r.reverses_payment_id
      where r.amount_cents <> -o.amount_cents
        or coalesce((select sum(amount_cents) from payment_allocations where payment_id = r.id), 0)
         <> -coalesce((select sum(amount_cents) from payment_allocations where payment_id = o.id), 0)`);
    await bad('total money in != allocations + net unallocated', sql`
      select 1 from (select
        coalesce((select sum(amount_cents) from payments), 0) as money,
        coalesce((select sum(amount_cents) from payment_allocations), 0) as alloc,
        coalesce((select sum(case when method = 'reversal' then -unallocated_cents else unallocated_cents end) from payments), 0) as unalloc) x
      where money <> alloc + unalloc`);
    await bad('a receipt exists for a reversal, or a payment lacks one', sql`
      select p.id from payments p left join receipts r on r.payment_id = p.id
      where (p.method = 'reversal') <> (r.id is null)`);
    await bad('receipt reversed_at disagrees with the ledger', sql`
      select r.id from receipts r where (r.reversed_at is not null) <> exists (select 1 from payments x where x.reverses_payment_id = r.payment_id)`);
    // Cached projection == fresh recompute.
    const fresh = new Map((await freshProjections(tx, t.clock.now())).map((r) => [r.id, r]));
    const cached = (await tx.execute<{ id: string; status: string; paid_cents: string }>(sql`select id, status::text, paid_cents::text from invoices`)).rows;
    for (const c of cached) {
      const f = fresh.get(c.id);
      if (!f || f.status !== c.status || Number(f.paid_cents) !== Number(c.paid_cents)) {
        throw new Error(`projection drift on ${c.id}: cached ${c.status}/${c.paid_cents} fresh ${f?.status}/${f?.paid_cents}`);
      }
    }
  });
  // canAccess agrees with "sum(allocations) >= amount and not voided" for every line.
  const fees = feesOf(t);
  for (const l of await lines(db, tenantId)) {
    const expected = !l.voided && l.paid >= l.amount_cents;
    const actual = await fees.canAccess(tenantId, l.student_id, l.class_id, l.month);
    if (actual !== expected) throw new Error(`canAccess(${l.id}) = ${actual}, expected ${expected}`);
  }
}
