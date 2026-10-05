import { and, asc, eq } from 'drizzle-orm';
import { schema, type Tx } from '@remix/db';
import type { Receipt } from '@remix/types/api';
import { feeNotFound } from './ledger';

const {
  receipts,
  payments,
  students,
  tenantUsers,
  tenants,
  tenantSettings,
  paymentAllocations,
  invoiceLines,
  classes,
} = schema;
/** Same data for the admin view, thermal print and the worker; callers enter withTenant first. */
export async function receiptData(tx: Tx, tenantId: string, id: string): Promise<Receipt> {
  const [row] = await tx
    .select({
      receipt: receipts,
      payment: payments,
      studentNo: students.studentNo,
      studentName: tenantUsers.displayName,
    })
    .from(receipts)
    .innerJoin(
      payments,
      and(eq(payments.tenantId, receipts.tenantId), eq(payments.id, receipts.paymentId)),
    )
    .innerJoin(
      students,
      and(eq(students.tenantId, payments.tenantId), eq(students.userId, payments.studentId)),
    )
    .innerJoin(
      tenantUsers,
      and(eq(tenantUsers.tenantId, students.tenantId), eq(tenantUsers.id, students.userId)),
    )
    .where(eq(receipts.id, id));
  const [tenant] = await tx.select().from(tenants).where(eq(tenants.id, tenantId));
  const [settings] = await tx.select().from(tenantSettings);
  if (!row || !tenant) throw feeNotFound();
  const lines = await tx
    .select({
      className: classes.name,
      month: invoiceLines.month,
      amountCents: paymentAllocations.amountCents,
    })
    .from(paymentAllocations)
    .innerJoin(
      invoiceLines,
      and(
        eq(invoiceLines.tenantId, paymentAllocations.tenantId),
        eq(invoiceLines.id, paymentAllocations.invoiceLineId),
      ),
    )
    .innerJoin(
      classes,
      and(eq(classes.tenantId, invoiceLines.tenantId), eq(classes.id, invoiceLines.classId)),
    )
    .where(eq(paymentAllocations.paymentId, row.payment.id))
    .orderBy(asc(invoiceLines.month), asc(invoiceLines.id));
  const { receipt: r, payment: p } = row;
  return {
    id: r.id,
    number: r.number,
    paymentId: p.id,
    issuedAt: r.issuedAt.toISOString(),
    method: p.method,
    amountCents: p.amountCents,
    cashReceivedCents: r.cashReceivedCents,
    changeCents: r.cashReceivedCents === null ? null : r.cashReceivedCents - p.amountCents,
    studentNo: row.studentNo,
    studentName: row.studentName,
    lines,
    reversedAt: r.reversedAt?.toISOString() ?? null,
    institute: {
      name: tenant.name,
      logoUrl: tenant.logoUrl,
      address: settings?.receiptAddress ?? null,
      phone: settings?.receiptPhone ?? null,
      footer: settings?.receiptFooter ?? null,
    },
  };
}
