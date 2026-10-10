import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  foreignKey,
  index,
  pgEnum,
  pgTable,
  smallint,
  text,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { CHECKOUT_STATUSES } from '@remix/types/api';
import { id, instant, tenantId } from './columns';
import { invoiceLines, payments } from './fees';
import { tenants } from './tenants';
import { students, tenantUsers } from './users';

/** `CHECKOUT_STATUSES` (contract). A chargeback keeps `paid` and sets `chargeback_at`. */
export const checkoutStatus = pgEnum('checkout_status', CHECKOUT_STATUSES);
/** `fees`: a student paying open months (FEE-04). `test`: the owner's SET-02 test payment. */
export const checkoutKind = pgEnum('checkout_kind', ['fees', 'test']);

/**
 * ADR 0008 §6: one PayHere order. The row id is the `order_id` sent to PayHere. Amount, merchant
 * and mode are snapshots taken when the order was signed; the notify must match them. Only the
 * state columns change afterwards (grants + `guard_checkout_lifecycle`).
 */
export const payhereCheckouts = pgTable(
  'payhere_checkouts',
  {
    id: id(),
    tenantId: tenantId().references(() => tenants.id, { onDelete: 'cascade' }),
    kind: checkoutKind('kind').notNull(),
    /** The paying student; null for an owner test. */
    studentId: uuid('student_id'),
    /** Who started it (the student, or the owner for a test). */
    createdBy: uuid('created_by').notNull(),
    amountCents: bigint('amount_cents', { mode: 'number' }).notNull(),
    currency: text('currency').notNull().default('LKR'),
    merchantId: text('merchant_id').notNull(),
    mode: text('mode').notNull(),
    status: checkoutStatus('status').notNull().default('pending'),
    createdAt: instant('created_at').notNull().defaultNow(),
    expiresAt: instant('expires_at').notNull(),
    /** Last verified notification. */
    statusCode: smallint('status_code'),
    notifiedAt: instant('notified_at'),
    /** PayHere `payment_id` of the successful payment. */
    providerPaymentId: text('provider_payment_id'),
    /** Ledger payment (fees checkouts once paid). */
    paymentId: uuid('payment_id'),
    /** PayHere reported a chargeback; flagged for the owner, never reversed automatically. */
    chargebackAt: instant('chargeback_at'),
  },
  (t) => [
    unique('payhere_checkouts_tenant_id_id_key').on(t.tenantId, t.id),
    unique('payhere_checkouts_tenant_payment_key').on(t.tenantId, t.paymentId),
    index('payhere_checkouts_tenant_student_created_idx').on(t.tenantId, t.studentId, t.createdAt),
    foreignKey({
      name: 'payhere_checkouts_student_fk',
      columns: [t.tenantId, t.studentId],
      foreignColumns: [students.tenantId, students.userId],
    }),
    foreignKey({
      name: 'payhere_checkouts_created_by_fk',
      columns: [t.tenantId, t.createdBy],
      foreignColumns: [tenantUsers.tenantId, tenantUsers.id],
    }),
    foreignKey({
      name: 'payhere_checkouts_payment_fk',
      columns: [t.tenantId, t.paymentId],
      foreignColumns: [payments.tenantId, payments.id],
    }),
    check('payhere_checkouts_amount_safe', sql`${t.amountCents} between 1 and 9007199254740991`),
    check('payhere_checkouts_currency', sql`${t.currency} = 'LKR'`),
    check('payhere_checkouts_mode', sql`${t.mode} in ('sandbox', 'live')`),
    check('payhere_checkouts_merchant', sql`${t.merchantId} ~ '^[0-9]{4,20}$'`),
    check('payhere_checkouts_expiry', sql`${t.expiresAt} > ${t.createdAt}`),
    check(
      'payhere_checkouts_kind_shape',
      sql`(${t.kind} = 'fees' and ${t.studentId} is not null and ${t.studentId} = ${t.createdBy})
        or (${t.kind} = 'test' and ${t.studentId} is null and ${t.paymentId} is null)`,
    ),
    check(
      'payhere_checkouts_paid_state',
      sql`(${t.status} = 'paid') = (${t.providerPaymentId} is not null)
        and (${t.kind} = 'test' or (${t.status} = 'paid') = (${t.paymentId} is not null))
        and (${t.chargebackAt} is null or ${t.status} = 'paid')
        and (${t.statusCode} is null or ${t.statusCode} between -3 and 2)
        and ((${t.statusCode} is null) = (${t.notifiedAt} is null))`,
    ),
    check(
      'payhere_checkouts_provider_payment_id',
      sql`${t.providerPaymentId} is null or char_length(${t.providerPaymentId}) between 1 and 40`,
    ),
  ],
);

/** The months a fees checkout pays; fixed when the order is created. */
export const payhereCheckoutLines = pgTable(
  'payhere_checkout_lines',
  {
    id: id(),
    tenantId: tenantId().references(() => tenants.id, { onDelete: 'cascade' }),
    checkoutId: uuid('checkout_id').notNull(),
    invoiceLineId: uuid('invoice_line_id').notNull(),
  },
  (t) => [
    unique('payhere_checkout_lines_tenant_id_id_key').on(t.tenantId, t.id),
    unique('payhere_checkout_lines_tenant_checkout_line_key').on(
      t.tenantId,
      t.checkoutId,
      t.invoiceLineId,
    ),
    index('payhere_checkout_lines_tenant_line_idx').on(t.tenantId, t.invoiceLineId),
    foreignKey({
      name: 'payhere_checkout_lines_checkout_fk',
      columns: [t.tenantId, t.checkoutId],
      foreignColumns: [payhereCheckouts.tenantId, payhereCheckouts.id],
    }),
    foreignKey({
      name: 'payhere_checkout_lines_line_fk',
      columns: [t.tenantId, t.invoiceLineId],
      foreignColumns: [invoiceLines.tenantId, invoiceLines.id],
    }),
  ],
);
