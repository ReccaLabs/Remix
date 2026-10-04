import { sql } from 'drizzle-orm';
import type { Tx } from '@remix/db';
import { monthSchema } from '@remix/types/api';
import { lockLedger } from './ledger';
import { recomputeProjections } from './projections';

/** Shared by monthly jobs and enrolment hooks. Set-based SQL keeps 2,000-student tenants cheap. */
export async function generateInvoices(tx: Tx, month: string, now: Date, enrollmentIds?: readonly string[]): Promise<number> {
  const canonical = monthSchema.parse(`${month.slice(0, 7)}-01`);
  if (month !== canonical && month !== canonical.slice(0, 7)) throw new RangeError('Use a billing month or its first day');
  if (enrollmentIds?.length === 0) return 0;
  const tenantId = await lockLedger(tx);
  const filter = enrollmentIds ? sql`and e.id in (${sql.join(enrollmentIds.map(id => sql`${id}::uuid`), sql`,`)})` : sql``;
  const eligible = sql`select e.id as enrollment_id, e.student_id, e.class_id, coalesce(e.fee_override_cents, c.fee_cents) as amount_cents, s.student_no
    from public.enrollments e join public.students s on s.tenant_id = e.tenant_id and s.user_id = e.student_id
    join public.classes c on c.tenant_id = e.tenant_id and c.id = e.class_id
    where e.tenant_id = ${tenantId} and e.from_month <= ${canonical}::date and (e.to_month is null or e.to_month >= ${canonical}::date)
      and s.archived_at is null and c.archived_at is null ${filter}`;
  await tx.execute(sql`with eligible as (${eligible})
    insert into public.invoices (tenant_id, student_id, number, month, due_on)
    select distinct ${tenantId}::uuid, e.student_id,
      t.student_no_prefix || '-I-' || to_char(${canonical}::date, 'YY-MM') || '-' || e.student_no,
      ${canonical}::date, ${canonical}::date + (coalesce(s.due_day, 5) - 1)
    from eligible e join public.tenants t on t.id = ${tenantId} left join public.tenant_settings s on s.tenant_id = t.id
    on conflict (tenant_id, student_id, month) do nothing`);
  const added = await tx.execute<{ invoice_id: string }>(sql`with eligible as (${eligible})
    insert into public.invoice_lines (tenant_id, invoice_id, enrollment_id, class_id, month, amount_cents)
    select ${tenantId}::uuid, i.id, e.enrollment_id, e.class_id, ${canonical}::date, e.amount_cents
    from eligible e join public.invoices i on i.tenant_id = ${tenantId} and i.student_id = e.student_id and i.month = ${canonical}::date
    on conflict (tenant_id, enrollment_id, month) do nothing returning invoice_id`);
  await recomputeProjections(tx, now, [...new Set(added.rows.map(r => r.invoice_id))]);
  return added.rowCount ?? 0;
}

/** Voids only ended enrolments' unallocated lines; money-bearing lines require reversal first. */
export async function voidEndedLines(tx: Tx, enrollmentIds: readonly string[], reason: string, now: Date): Promise<number> {
  if (!enrollmentIds.length) return 0;
  await lockLedger(tx);
  const ids = sql.join(enrollmentIds.map(id => sql`${id}::uuid`), sql`,`);
  const result = await tx.execute<{ invoice_id: string }>(sql`
    update public.invoice_lines l set voided_at = ${now}, void_reason = ${reason}
    from public.enrollments e where e.tenant_id = l.tenant_id and e.id = l.enrollment_id and e.id in (${ids})
      and e.to_month is not null and l.month > e.to_month and l.voided_at is null
      and l.amount_cents > 0
      and coalesce((select sum(a.amount_cents) from public.payment_allocations a where a.tenant_id = l.tenant_id and a.invoice_line_id = l.id), 0) = 0
    returning l.invoice_id`);
  await recomputeProjections(tx, now, [...new Set(result.rows.map(r => r.invoice_id))]);
  return result.rowCount ?? 0;
}
