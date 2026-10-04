import { sql } from 'drizzle-orm';
import { bigint, boolean, check, date, foreignKey, index, pgEnum, pgTable, smallint, text, unique, uuid } from 'drizzle-orm/pg-core';
import { id, instant, tenantId } from './columns';
import { classes, enrollments } from './classes';
import { tenants } from './tenants';
import { students, tenantUsers } from './users';

export const invoiceStatus = pgEnum('invoice_status', ['unpaid', 'partially_paid', 'paid', 'overdue']);
export const paymentMethod = pgEnum('payment_method', ['card', 'slip', 'cash', 'manual', 'reversal']);
const cents = (name: string) => bigint(name, { mode: 'number' });

export const tenantSettings = pgTable('tenant_settings', {
  id: id(), tenantId: tenantId().references(() => tenants.id, { onDelete: 'cascade' }),
  dueDay: smallint('due_day').notNull().default(5),
  unlockBeforeDue: boolean('unlock_before_due').notNull().default(false),
}, (t) => [
  unique('tenant_settings_tenant_id_id_key').on(t.tenantId, t.id),
  unique('tenant_settings_tenant_key').on(t.tenantId),
  check('tenant_settings_due_day_range', sql`${t.dueDay} between 1 and 28`),
  check('tenant_settings_no_grace_r1', sql`not ${t.unlockBeforeDue}`),
]);

/** Immutable invoice identity/due date; status and paid_cents are rebuildable projections. */
export const invoices = pgTable('invoices', {
  id: id(), tenantId: tenantId().references(() => tenants.id, { onDelete: 'cascade' }),
  studentId: uuid('student_id').notNull(), number: text('number').notNull(),
  month: date('month').notNull(), dueOn: date('due_on').notNull(),
  status: invoiceStatus('status').notNull().default('unpaid'),
  paidCents: cents('paid_cents').notNull().default(0),
  createdAt: instant('created_at').notNull().defaultNow(),
}, (t) => [
  unique('invoices_tenant_id_id_key').on(t.tenantId, t.id),
  unique('invoices_tenant_id_id_month_key').on(t.tenantId, t.id, t.month),
  unique('invoices_tenant_student_month_key').on(t.tenantId, t.studentId, t.month),
  unique('invoices_tenant_number_key').on(t.tenantId, t.number),
  index('invoices_tenant_month_idx').on(t.tenantId, t.month),
  foreignKey({ name: 'invoices_student_fk', columns: [t.tenantId, t.studentId], foreignColumns: [students.tenantId, students.userId] }),
  check('invoices_month_first_day', sql`extract(day from ${t.month}) = 1`),
  check('invoices_due_in_month', sql`date_trunc('month', ${t.dueOn}::timestamp)::date = ${t.month}`),
  check('invoices_paid_safe', sql`${t.paidCents} between 0 and 9007199254740991`),
]);

/** Class and fee snapshots survive enrolment moves and class fee edits. */
export const invoiceLines = pgTable('invoice_lines', {
  id: id(), tenantId: tenantId().references(() => tenants.id, { onDelete: 'cascade' }),
  invoiceId: uuid('invoice_id').notNull(), enrollmentId: uuid('enrollment_id').notNull(),
  classId: uuid('class_id').notNull(), month: date('month').notNull(),
  amountCents: cents('amount_cents').notNull(), voidedAt: instant('voided_at'), voidReason: text('void_reason'),
  createdAt: instant('created_at').notNull().defaultNow(),
}, (t) => [
  unique('invoice_lines_tenant_id_id_key').on(t.tenantId, t.id),
  unique('invoice_lines_tenant_enrollment_month_key').on(t.tenantId, t.enrollmentId, t.month),
  index('invoice_lines_tenant_invoice_idx').on(t.tenantId, t.invoiceId),
  foreignKey({ name: 'invoice_lines_invoice_fk', columns: [t.tenantId, t.invoiceId, t.month], foreignColumns: [invoices.tenantId, invoices.id, invoices.month] }),
  foreignKey({ name: 'invoice_lines_enrollment_fk', columns: [t.tenantId, t.enrollmentId], foreignColumns: [enrollments.tenantId, enrollments.id] }),
  foreignKey({ name: 'invoice_lines_class_fk', columns: [t.tenantId, t.classId], foreignColumns: [classes.tenantId, classes.id] }),
  check('invoice_lines_month_first_day', sql`extract(day from ${t.month}) = 1`),
  check('invoice_lines_amount_safe', sql`${t.amountCents} between 0 and 100000000`),
  check('invoice_lines_void_reason', sql`(${t.voidedAt} is null and ${t.voidReason} is null) or (${t.voidedAt} is not null and char_length(${t.voidReason}) >= 3)`),
]);

/** Append-only, including immutable surplus; reversal rows carry the original surplus magnitude. */
export const payments = pgTable('payments', {
  id: id(), tenantId: tenantId().references(() => tenants.id, { onDelete: 'cascade' }),
  studentId: uuid('student_id').notNull(), method: paymentMethod('method').notNull(),
  amountCents: cents('amount_cents').notNull(), unallocatedCents: cents('unallocated_cents').notNull().default(0),
  needsRefund: boolean('needs_refund').notNull().default(false),
  receivedBy: uuid('received_by'), receivedAt: instant('received_at').notNull().defaultNow(),
  providerRef: text('provider_ref'), note: text('note'), idempotencyKey: text('idempotency_key').notNull(),
  reversesPaymentId: uuid('reverses_payment_id'),
}, (t) => [
  unique('payments_tenant_id_id_key').on(t.tenantId, t.id),
  unique('payments_tenant_idempotency_key').on(t.tenantId, t.idempotencyKey),
  unique('payments_tenant_reverses_key').on(t.tenantId, t.reversesPaymentId),
  index('payments_tenant_student_received_idx').on(t.tenantId, t.studentId, t.receivedAt),
  foreignKey({ name: 'payments_student_fk', columns: [t.tenantId, t.studentId], foreignColumns: [students.tenantId, students.userId] }),
  foreignKey({ name: 'payments_received_by_fk', columns: [t.tenantId, t.receivedBy], foreignColumns: [tenantUsers.tenantId, tenantUsers.id] }),
  foreignKey({ name: 'payments_reverses_fk', columns: [t.tenantId, t.reversesPaymentId], foreignColumns: [t.tenantId, t.id] }),
  check('payments_amount_safe', sql`${t.amountCents} between -9007199254740991 and 9007199254740991`),
  check('payments_reversal_sign', sql`(${t.method} = 'reversal' and ${t.amountCents} <= 0 and ${t.reversesPaymentId} is not null and ${t.reversesPaymentId} <> ${t.id}) or (${t.method} <> 'reversal' and ${t.amountCents} >= 0 and ${t.reversesPaymentId} is null)`),
  check('payments_surplus_bounds', sql`${t.unallocatedCents} between 0 and abs(${t.amountCents}) and (${t.method} in ('card', 'reversal') or ${t.unallocatedCents} = 0)`),
  check('payments_refund_flag', sql`${t.needsRefund} = (${t.method} = 'card' and ${t.unallocatedCents} > 0)`),
  check('payments_idempotency_length', sql`char_length(${t.idempotencyKey}) between 1 and 200`),
]);

/** Negative entries are permitted only for reversal payments (also checked by a DB trigger). */
export const paymentAllocations = pgTable('payment_allocations', {
  id: id(), tenantId: tenantId().references(() => tenants.id, { onDelete: 'cascade' }),
  paymentId: uuid('payment_id').notNull(), invoiceLineId: uuid('invoice_line_id').notNull(),
  amountCents: cents('amount_cents').notNull(),
}, (t) => [
  unique('payment_allocations_tenant_id_id_key').on(t.tenantId, t.id),
  unique('payment_allocations_tenant_payment_line_key').on(t.tenantId, t.paymentId, t.invoiceLineId),
  index('payment_allocations_tenant_line_idx').on(t.tenantId, t.invoiceLineId),
  foreignKey({ name: 'payment_allocations_payment_fk', columns: [t.tenantId, t.paymentId], foreignColumns: [payments.tenantId, payments.id] }),
  foreignKey({ name: 'payment_allocations_line_fk', columns: [t.tenantId, t.invoiceLineId], foreignColumns: [invoiceLines.tenantId, invoiceLines.id] }),
  check('payment_allocations_amount_safe', sql`${t.amountCents} between -100000000 and 100000000 and ${t.amountCents} <> 0`),
]);

export const receipts = pgTable('receipts', {
  id: id(), tenantId: tenantId().references(() => tenants.id, { onDelete: 'cascade' }),
  paymentId: uuid('payment_id').notNull(), number: text('number').notNull(),
  issuedAt: instant('issued_at').notNull().defaultNow(),
  cashReceivedCents: cents('cash_received_cents'), reversedAt: instant('reversed_at'), pdfKey: text('pdf_key'),
}, (t) => [
  unique('receipts_tenant_id_id_key').on(t.tenantId, t.id),
  unique('receipts_tenant_payment_key').on(t.tenantId, t.paymentId),
  unique('receipts_tenant_number_key').on(t.tenantId, t.number),
  foreignKey({ name: 'receipts_payment_fk', columns: [t.tenantId, t.paymentId], foreignColumns: [payments.tenantId, payments.id] }),
  check('receipts_cash_received_safe', sql`${t.cashReceivedCents} between 0 and 9007199254740991`),
  check('receipts_pdf_tenant_prefix', sql`${t.pdfKey} like ${t.tenantId}::text || '/%'`),
]);
