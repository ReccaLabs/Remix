import { sql, type SQL } from 'drizzle-orm';
import type { Tx } from '@remix/db';
import type { InvoiceStatus } from '@remix/types/api';
import { calendarDate } from '../../common/time/business-date';

export interface ProjectionRow extends Record<string, unknown> {
  id: string; student_id: string; number: string; month: string; due_on: string;
  total_cents: string; paid_cents: string; status: InvoiceStatus;
}

/** One source for projection rebuilds and fresh reads; all sums come from signed allocations. */
export function projectionCtes(now: Date): SQL {
  return sql`with line_balances as (
    select l.*, coalesce(a.paid, 0) as paid
    from public.invoice_lines l left join (
      select tenant_id, invoice_line_id, sum(amount_cents) as paid
      from public.payment_allocations group by tenant_id, invoice_line_id
    ) a on a.tenant_id = l.tenant_id and a.invoice_line_id = l.id
  ), invoice_totals as (
    select i.id, i.student_id, i.number, i.month::text, i.due_on::text,
      coalesce(sum(l.amount_cents) filter (where l.voided_at is null), 0) as total_cents,
      coalesce(sum(l.paid) filter (where l.voided_at is null), 0) as paid_cents,
      count(l.id) filter (where l.voided_at is null) as lines,
      count(l.id) filter (where l.voided_at is null and l.paid >= l.amount_cents) as paid_lines
    from public.invoices i left join line_balances l on l.tenant_id = i.tenant_id and l.invoice_id = i.id
    group by i.id
  ), projections as (
    select *, case when paid_lines = lines then 'paid'
      when paid_lines > 0 then 'partially_paid'
      when ${calendarDate(now)}::date > due_on::date then 'overdue' else 'unpaid' end as status
    from invoice_totals
  )`;
}

export async function freshProjections(tx: Tx, now: Date): Promise<ProjectionRow[]> {
  return (await tx.execute<ProjectionRow>(sql`${projectionCtes(now)} select * from projections`)).rows;
}

/** Caller holds the ledger lock; changed ids let the nightly job alert on projection drift. */
export async function recomputeProjections(tx: Tx, now: Date, invoiceIds?: readonly string[]): Promise<string[]> {
  if (invoiceIds?.length === 0) return [];
  const filter = invoiceIds ? sql`and i.id in (${sql.join(invoiceIds.map(id => sql`${id}::uuid`), sql`,`)})` : sql``;
  const result = await tx.execute<{ id: string }>(sql`${projectionCtes(now)}
    update public.invoices i set paid_cents = p.paid_cents, status = p.status::public.invoice_status
    from projections p where i.id = p.id ${filter}
      and (i.paid_cents is distinct from p.paid_cents or i.status::text is distinct from p.status)
    returning i.id`);
  return result.rows.map(r => r.id);
}

export function safeCents(value: number | string): number {
  const n = Number(value);
  if (!Number.isSafeInteger(n)) throw new RangeError('Ledger amount exceeds safe integer cents');
  return n;
}
