import { sql } from 'drizzle-orm';
import { withTenant, type Db } from '@remix/db';
import { monthSchema } from '@remix/types/api';

/** The single unlock rule; never trusts the mutable invoice status projection. */
export async function canAccess(db: Db, tenantId: string, studentId: string, classId: string, month: string): Promise<boolean> {
  const date = monthSchema.parse(month.length === 7 ? `${month}-01` : month);
  return withTenant(db, tenantId, async tx => {
    const [row] = (await tx.execute<{ allowed: boolean }>(sql`select exists (
      select 1 from public.invoice_lines l join public.invoices i on i.tenant_id = l.tenant_id and i.id = l.invoice_id
      where i.student_id = ${studentId}::uuid and l.class_id = ${classId}::uuid and l.month = ${date}::date and l.voided_at is null
        and coalesce((select sum(a.amount_cents) from public.payment_allocations a
          where a.tenant_id = l.tenant_id and a.invoice_line_id = l.id), 0) >= l.amount_cents
    ) as allowed`)).rows;
    return row?.allowed ?? false;
  });
}
