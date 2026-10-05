import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, inArray, sql, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { schema, withTenant, type Db, type Tx } from '@remix/db';
import type { API, CashPaymentRequest, ManualPaymentRequest, InvoiceLine, MyFeesResponse, Payment, Receipt } from '@remix/types/api';
import type { z } from 'zod';
import type { AuthSession } from '../../common/auth/session-authenticator';
import { AppException } from '../../common/errors/app-exception';
import { calendarDate } from '../../common/time/business-date';
import { CLOCK, type Clock } from '../../common/time/clock';
import { AuditService } from '../audit/audit.service';
import { DB } from '../db/db.module';
import { canAccess } from './access';
import { collectCash, collectManual } from './collection';
import { receiptData } from './receipt-data';
import { FeesHooks } from './fees-hooks';
import { generateInvoices } from './invoice-generation';
import { feeNotFound, recordPayment, reversePayment, type RecordPaymentInput } from './ledger';
import { projectionCtes, safeCents, type ProjectionRow } from './projections';

const { payments, receipts, students, tenantUsers, invoiceLines, invoices, paymentAllocations, classes } = schema;
type InvoiceQuery = z.output<typeof API.listInvoices.query>;
type PaymentQuery = z.output<typeof API.listPayments.query>;
const receiver = alias(tenantUsers, 'receiver');

@Injectable()
export class FeesService {
  constructor(@Inject(DB) private readonly db: Db, @Inject(CLOCK) private readonly clock: Clock,
    private readonly audit: AuditService, private readonly hooks: FeesHooks) {}

  async recordCashPayment(tenantId: string, session: AuthSession, body: CashPaymentRequest): Promise<Payment> {
    const recorded = await withTenant(this.db, tenantId, tx => collectCash(tx, body, session.userId, this.clock.now(), this.audit));
    if (recorded.receiptId && !recorded.replayed) await this.hooks.onPaymentCommitted({ tenantId, paymentId: recorded.payment.id,
      receiptId: recorded.receiptId, jobKey: `receipt:${tenantId}:${recorded.payment.id}` });
    return this.getPayment(tenantId, recorded.payment.id);
  }

  async recordManualPayment(tenantId: string, session: AuthSession, body: ManualPaymentRequest): Promise<Payment> {
    const recorded = await withTenant(this.db, tenantId, tx => collectManual(tx, body, session.userId, this.clock.now(), this.audit));
    if (recorded.receiptId && !recorded.replayed) await this.hooks.onPaymentCommitted({ tenantId, paymentId: recorded.payment.id,
      receiptId: recorded.receiptId, jobKey: `receipt:${tenantId}:${recorded.payment.id}` });
    return this.getPayment(tenantId, recorded.payment.id);
  }

  async recordPayment(tenantId: string, input: RecordPaymentInput) {
    const recorded = await withTenant(this.db, tenantId, tx => recordPayment(tx, input, this.clock.now(), this.audit));
    if (recorded.receiptId && !recorded.replayed) await this.hooks.onPaymentCommitted({ tenantId, paymentId: recorded.payment.id,
      receiptId: recorded.receiptId, jobKey: `receipt:${tenantId}:${recorded.payment.id}` });
    return recorded;
  }

  generateInvoices(tenantId: string, month: string) {
    return withTenant(this.db, tenantId, tx => generateInvoices(tx, month, this.clock.now()));
  }

  canAccess(tenantId: string, studentId: string, classId: string, month: string) {
    return canAccess(this.db, tenantId, studentId, classId, month);
  }

  async reversePayment(tenantId: string, session: AuthSession, id: string, reason: string): Promise<Payment> {
    if (!session.roles.includes('owner')) throw new AppException('FORBIDDEN', 403);
    return withTenant(this.db, tenantId, async tx => {
      const reversed = await reversePayment(tx, id, reason, session.userId, this.clock.now(), this.audit);
      const [row] = await this.paymentRows(tx, eq(payments.id, reversed.payment.id));
      if (!row) throw feeNotFound();
      return row;
    });
  }

  listInvoices(tenantId: string, query: InvoiceQuery) {
    return withTenant(this.db, tenantId, async tx => {
      const conditions: SQL[] = [];
      if (query.month) conditions.push(sql`p.month::date = ${query.month}::date`);
      if (query.filter === 'paid') conditions.push(sql`p.status = 'paid'`);
      if (query.filter === 'unpaid') conditions.push(sql`p.status <> 'paid'`);
      if (query.filter === 'overdue') conditions.push(sql`p.status = 'overdue'`);
      // Slip lifecycle arrives in 3-D; no submitted slips can exist yet.
      if (query.filter === 'slip_waiting') conditions.push(sql`false`);
      if (query.classId) conditions.push(sql`exists (select 1 from public.invoice_lines l where l.invoice_id = p.id and l.class_id = ${query.classId}::uuid and l.voided_at is null)`);
      if (query.q) {
        const q = `%${query.q.replace(/[\\%_]/g, c => `\\${c}`)}%`;
        conditions.push(sql`(u.display_name ilike ${q} or s.student_no ilike ${q})`);
      }
      const where = conditions.length ? sql`where ${sql.join(conditions, sql` and `)}` : sql``;
      const joined = sql`from projections p join public.students s on s.user_id = p.student_id
        join public.tenant_users u on u.tenant_id = s.tenant_id and u.id = s.user_id ${where}`;
      const ctes = projectionCtes(this.clock.now());
      const [totals] = (await tx.execute<{ total: string; total_cents: string; paid_cents: string }>(sql`${ctes}
        select count(*) as total, coalesce(sum(p.total_cents), 0) as total_cents, coalesce(sum(p.paid_cents), 0) as paid_cents ${joined}`)).rows;
      const rows = (await tx.execute<ProjectionRow & { student_no: string; student_name: string }>(sql`${ctes}
        select p.*, s.student_no, u.display_name as student_name ${joined}
        order by p.month desc, p.id desc limit ${query.pageSize} offset ${(query.page - 1) * query.pageSize}`)).rows;
      return { page: query.page, pageSize: query.pageSize, total: Number(totals?.total ?? 0),
        totals: { totalCents: safeCents(totals?.total_cents ?? 0), paidCents: safeCents(totals?.paid_cents ?? 0) },
        items: rows.map(r => ({ id: r.id, number: r.number, studentId: r.student_id, studentNo: r.student_no, studentName: r.student_name,
          month: r.month, dueOn: r.due_on, totalCents: safeCents(r.total_cents), paidCents: safeCents(r.paid_cents), status: r.status, slipWaiting: false })) };
    });
  }

  listPayments(tenantId: string, query: PaymentQuery) {
    return withTenant(this.db, tenantId, async tx => {
      if (query.from && query.to && query.from > query.to) throw new AppException('VALIDATION_FAILED', 400, 'From date must precede to date');
      const conditions: (SQL | undefined)[] = [
        query.method ? eq(payments.method, query.method) : undefined,
        query.studentId ? eq(payments.studentId, query.studentId) : undefined,
        query.from ? sql`(${payments.receivedAt} at time zone 'Asia/Colombo')::date >= ${query.from}::date` : undefined,
        query.to ? sql`(${payments.receivedAt} at time zone 'Asia/Colombo')::date <= ${query.to}::date` : undefined,
        query.needsRefund ? sql`(${payments.needsRefund} and not exists (select 1 from public.payments r where r.tenant_id = ${payments.tenantId} and r.reverses_payment_id = ${payments.id})) = ${query.needsRefund === 'true'}` : undefined,
      ];
      const where = and(...conditions);
      const [count] = await tx.select({ n: sql<string>`count(*)` }).from(payments).where(where);
      return { page: query.page, pageSize: query.pageSize, total: Number(count?.n ?? 0),
        items: await this.paymentRows(tx, where, query.pageSize, (query.page - 1) * query.pageSize) };
    });
  }

  getPayment(tenantId: string, id: string): Promise<Payment> {
    return withTenant(this.db, tenantId, async tx => {
      const [row] = await this.paymentRows(tx, eq(payments.id, id));
      if (!row) throw feeNotFound();
      return row;
    });
  }

  private async paymentRows(tx: Tx, where?: SQL, limit = 10000, offset = 0): Promise<Payment[]> {
    const rows = await tx.select({ payment: payments, studentName: tenantUsers.displayName, receiverName: receiver.displayName,
      receiptId: receipts.id, receiptNumber: receipts.number }).from(payments)
      .innerJoin(tenantUsers, and(eq(tenantUsers.tenantId, payments.tenantId), eq(tenantUsers.id, payments.studentId)))
      .leftJoin(receiver, and(eq(receiver.tenantId, payments.tenantId), eq(receiver.id, payments.receivedBy)))
      .leftJoin(receipts, and(eq(receipts.tenantId, payments.tenantId), eq(receipts.paymentId, payments.id)))
      .where(where).orderBy(desc(payments.receivedAt), desc(payments.id)).limit(limit).offset(offset);
    if (!rows.length) return [];
    const ids = rows.map(r => r.payment.id);
    const allocations = await tx.select({ paymentId: paymentAllocations.paymentId, lineId: invoiceLines.id,
      className: classes.name, month: invoiceLines.month, amountCents: paymentAllocations.amountCents }).from(paymentAllocations)
      .innerJoin(invoiceLines, and(eq(invoiceLines.tenantId, paymentAllocations.tenantId), eq(invoiceLines.id, paymentAllocations.invoiceLineId)))
      .innerJoin(classes, and(eq(classes.tenantId, invoiceLines.tenantId), eq(classes.id, invoiceLines.classId)))
      .where(inArray(paymentAllocations.paymentId, ids)).orderBy(asc(invoiceLines.month), asc(invoiceLines.id));
    const reversals = await tx.select({ id: payments.id, original: payments.reversesPaymentId }).from(payments).where(inArray(payments.reversesPaymentId, ids));
    const reversed = new Map(reversals.map(r => [r.original, r.id]));
    return rows.map(({ payment: p, ...r }) => ({ id: p.id, method: p.method, amountCents: p.amountCents,
      unallocatedCents: p.unallocatedCents, needsRefund: p.needsRefund && !reversed.has(p.id), studentId: p.studentId,
      studentName: r.studentName, receivedAt: p.receivedAt.toISOString(), receivedByName: r.receiverName,
      reference: p.providerRef, note: p.note, reversedByPaymentId: reversed.get(p.id) ?? null, reversesPaymentId: p.reversesPaymentId,
      receiptId: r.receiptId, receiptNumber: r.receiptNumber,
      lines: allocations.filter(a => a.paymentId === p.id).map(a => ({ lineId: a.lineId, className: a.className, month: a.month, amountCents: a.amountCents })) }));
  }

  studentFees(tenantId: string, studentId: string) {
    return withTenant(this.db, tenantId, tx => this.studentFeesRows(tx, studentId));
  }

  async myFees(tenantId: string, session: AuthSession): Promise<MyFeesResponse> {
    if (session.kind !== 'student') throw new AppException('FORBIDDEN', 403);
    return withTenant(this.db, tenantId, async tx => {
      const own = await this.studentFeesRows(tx, session.userId);
      const [settings] = await tx.select({ bankDetails: schema.tenantSettings.bankDetails }).from(schema.tenantSettings);
      const [payhere] = await tx.select({ config: schema.tenantIntegrations.config }).from(schema.tenantIntegrations)
        .where(eq(schema.tenantIntegrations.kind, 'payhere'));
      return { openLines: own.openLines,
        payments: own.payments.map(({ needsRefund: _needsRefund, unallocatedCents: _unallocated, ...payment }) => payment),
        slips: [], // TODO(3-D): the slips table/lifecycle does not exist yet.
        cardEnabled: payhere?.config.enabled ?? false, bankDetails: settings?.bankDetails ?? null };
    });
  }

  private async studentFeesRows(tx: Tx, studentId: string) {
      const [student] = await tx.select({ studentNo: students.studentNo, displayName: tenantUsers.displayName }).from(students)
        .innerJoin(tenantUsers, and(eq(tenantUsers.tenantId, students.tenantId), eq(tenantUsers.id, students.userId))).where(eq(students.userId, studentId));
      if (!student) throw feeNotFound();
      const lines = await tx.select({ line: invoiceLines, number: invoices.number, dueOn: invoices.dueOn, className: classes.name,
        paid: sql<string>`coalesce((select sum(a.amount_cents) from public.payment_allocations a where a.tenant_id = ${invoiceLines.tenantId} and a.invoice_line_id = ${invoiceLines.id}), 0)` }).from(invoiceLines)
        .innerJoin(invoices, and(eq(invoices.tenantId, invoiceLines.tenantId), eq(invoices.id, invoiceLines.invoiceId)))
        .innerJoin(classes, and(eq(classes.tenantId, invoiceLines.tenantId), eq(classes.id, invoiceLines.classId)))
        .where(and(eq(invoices.studentId, studentId), sql`${invoiceLines.voidedAt} is null`)).orderBy(asc(invoiceLines.month), asc(invoiceLines.id));
      const today = calendarDate(this.clock.now());
      const openLines: InvoiceLine[] = lines.filter(r => safeCents(r.paid) < r.line.amountCents).map(r => ({ id: r.line.id, invoiceId: r.line.invoiceId,
        invoiceNumber: r.number, enrollmentId: r.line.enrollmentId, classId: r.line.classId, className: r.className,
        month: r.line.month, dueOn: r.dueOn, amountCents: r.line.amountCents, paidCents: safeCents(r.paid),
        openCents: r.line.amountCents - safeCents(r.paid), paid: false, overdue: today > r.dueOn, slipWaiting: false }));
      return { studentId, ...student, openLines, payments: await this.paymentRows(tx, eq(payments.studentId, studentId)) };
  }

  getReceipt(tenantId: string, id: string): Promise<Receipt> {
    return withTenant(this.db, tenantId, tx => receiptData(tx, tenantId, id));
  }
}
