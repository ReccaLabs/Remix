import { and, asc, eq, sql } from 'drizzle-orm';
import type { Tx } from '../client';
import { allocateNumbers } from '../counters';
import { classes, enrollments, invoices, invoiceLines, payments, paymentAllocations, receipts, students } from '../schema';

/** Small, deterministic money examples; existing people, enrolments and student counters stay intact. */
export async function seedFees(tx: Tx, tenantId: string, prefix: string, ownerId: string): Promise<void> {
  const selected = await tx.select({ enrollmentId: enrollments.id, studentId: students.userId, studentNo: students.studentNo,
    classId: classes.id, fee: sql<number>`coalesce(${enrollments.feeOverrideCents}, ${classes.feeCents})`.mapWith(Number) })
    .from(enrollments).innerJoin(students, and(eq(students.tenantId, enrollments.tenantId), eq(students.userId, enrollments.studentId)))
    .innerJoin(classes, and(eq(classes.tenantId, enrollments.tenantId), eq(classes.id, enrollments.classId)))
    .where(eq(enrollments.tenantId, tenantId)).orderBy(asc(students.studentNo), asc(classes.name));
  const examples = [...new Map(selected.map(r => [r.studentId, r])).values()].slice(0, 3);
  const at = new Date('2026-10-15T04:30:00Z');
  for (const [index, s] of examples.entries()) {
    for (const month of ['2026-10-01', '2026-11-01', '2026-12-01']) {
      const [invoice] = await tx.insert(invoices).values({ tenantId, studentId: s.studentId,
        number: `${prefix}-I-${month.slice(2,7)}-${s.studentNo}`, month, dueOn: `${month.slice(0,7)}-05`,
        status: month === '2026-10-01' && s.fee > 0 ? 'overdue' : s.fee === 0 ? 'paid' : 'unpaid', createdAt: at }).returning();
      if (!invoice) throw new Error('seed invoice missing');
      const [line] = await tx.insert(invoiceLines).values({ tenantId, invoiceId: invoice.id, enrollmentId: s.enrollmentId,
        classId: s.classId, month, amountCents: s.fee, createdAt: at }).returning();
      if (!line) throw new Error('seed line missing');
      if (index > 1 || month !== '2026-10-01') continue;
      const [payment] = await tx.insert(payments).values({ tenantId, studentId: s.studentId, method: 'cash', amountCents: s.fee,
        receivedBy: ownerId, receivedAt: at, idempotencyKey: `seed-cash-${s.studentNo}-${month}` }).returning();
      if (!payment) throw new Error('seed payment missing');
      if (s.fee > 0) await tx.insert(paymentAllocations).values({ tenantId, paymentId: payment.id, invoiceLineId: line.id, amountCents: s.fee });
      const block = await allocateNumbers(tx, 'receipt', 1, '2026');
      await tx.insert(receipts).values({ tenantId, paymentId: payment.id, number: `${prefix}-R-26-${String(block.first).padStart(5,'0')}`,
        cashReceivedCents: s.fee + 10000, issuedAt: at, reversedAt: index === 1 ? at : null });
      if (index === 1) {
        const [reversal] = await tx.insert(payments).values({ tenantId, studentId: s.studentId, method: 'reversal', amountCents: -s.fee,
          receivedBy: ownerId, receivedAt: at, reversesPaymentId: payment.id, idempotencyKey: `seed-reversal-${s.studentNo}`, note: 'Seed reversal example' }).returning();
        if (!reversal) throw new Error('seed reversal missing');
        if (s.fee > 0) await tx.insert(paymentAllocations).values({ tenantId, paymentId: reversal.id, invoiceLineId: line.id, amountCents: -s.fee });
      } else await tx.update(invoices).set({ status: 'paid', paidCents: s.fee }).where(eq(invoices.id, invoice.id));
    }
  }
}
