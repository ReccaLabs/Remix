import { z } from 'zod';
import { ADDONS } from '../pricing';
import { dateSchema, isoDateTime, monthSchema, pageMetaSchema, pageQuerySchema } from './common';

/**
 * Phase 3 — money. Rules: ADR 0008 (ledger) and 0009 (storage). Amounts are integer cents
 * (`*Cents`). "Paid" is always derived from allocations; clients never send a status.
 */

/** One month of one class (bounded like a class fee). */
const cents = z.number().int().min(0).max(100_000_000);
/**
 * Sums: invoices with several classes, payments over several months, list totals, SMS costs.
 * A fresh schema on purpose: chaining `.max()` onto `cents` would keep its lower cap.
 */
const totalCents = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);

/** Client-generated per user action (e.g. one cash-counter submit); retries reuse it (ADR 0008 §4). */
export const idempotencyKeySchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]{16,64}$/, 'Use 16–64 URL-safe characters');

const lineIds = z.array(z.uuid()).min(1).max(24);

// ----- Invoices ------------------------------------------------------------------------------

export const INVOICE_STATUSES = ['unpaid', 'partially_paid', 'paid', 'overdue'] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

/** One month of one class for one student (ADR 0008 §1). */
export const invoiceLineSchema = z.object({
  id: z.uuid(),
  invoiceId: z.uuid(),
  invoiceNumber: z.string(),
  enrollmentId: z.uuid(),
  classId: z.uuid(),
  className: z.string(),
  month: monthSchema,
  dueOn: dateSchema,
  amountCents: cents,
  paidCents: cents,
  /** amount − paid, never negative. */
  openCents: cents,
  paid: z.boolean(),
  overdue: z.boolean(),
  /** A submitted slip covers this line and waits for review. */
  slipWaiting: z.boolean(),
});
export type InvoiceLine = z.infer<typeof invoiceLineSchema>;

/** FEE-02 filters. `slip_waiting` = has a submitted slip. */
export const INVOICE_FILTERS = ['all', 'paid', 'unpaid', 'overdue', 'slip_waiting'] as const;

export const listInvoicesQuerySchema = pageQuerySchema.extend({
  month: monthSchema.optional(),
  filter: z.enum(INVOICE_FILTERS).default('all'),
  classId: z.uuid().optional(),
  q: z.string().trim().max(80).optional(),
});
export type ListInvoicesQuery = z.input<typeof listInvoicesQuerySchema>;

export const invoiceListItemSchema = z.object({
  id: z.uuid(),
  number: z.string(),
  studentId: z.uuid(),
  studentNo: z.string(),
  studentName: z.string(),
  month: monthSchema,
  dueOn: dateSchema,
  totalCents: totalCents,
  paidCents: totalCents,
  status: z.enum(INVOICE_STATUSES),
  slipWaiting: z.boolean(),
});
export type InvoiceListItem = z.infer<typeof invoiceListItemSchema>;

export const listInvoicesResponseSchema = pageMetaSchema.extend({
  items: z.array(invoiceListItemSchema),
  /** Totals over the whole filter, not just this page. */
  totals: z.object({
    totalCents: totalCents,
    paidCents: totalCents,
  }),
});
export type ListInvoicesResponse = z.infer<typeof listInvoicesResponseSchema>;

// ----- Payments ------------------------------------------------------------------------------

export const PAYMENT_METHODS = ['card', 'slip', 'cash', 'manual', 'reversal'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

/** FEE-08 — how a manual payment arrived. */
export const MANUAL_PAYMENT_KINDS = ['bank_transfer', 'cheque', 'other'] as const;

export const paymentSchema = z.object({
  id: z.uuid(),
  method: z.enum(PAYMENT_METHODS),
  /** Negative only for reversals. */
  amountCents: z.number().int().min(-Number.MAX_SAFE_INTEGER).max(Number.MAX_SAFE_INTEGER),
  unallocatedCents: totalCents,
  /** Card surplus the owner must refund by hand (ADR 0008 §4.4). */
  needsRefund: z.boolean(),
  studentId: z.uuid(),
  studentName: z.string(),
  receivedAt: isoDateTime,
  receivedByName: z.string().nullable(),
  reference: z.string().nullable(),
  note: z.string().nullable(),
  reversedByPaymentId: z.uuid().nullable(),
  reversesPaymentId: z.uuid().nullable(),
  receiptId: z.uuid().nullable(),
  receiptNumber: z.string().nullable(),
  lines: z.array(
    z.object({
      lineId: z.uuid(),
      className: z.string(),
      month: monthSchema,
      amountCents: z.number().int(),
    }),
  ),
});
export type Payment = z.infer<typeof paymentSchema>;

/** FEE-07 — the counter must cover the selected lines exactly; change is shown, not stored. */
export const cashPaymentSchema = z.strictObject({
  studentId: z.uuid(),
  lineIds,
  /** Cash handed over, printed on the receipt; must be ≥ the total. */
  cashReceivedCents: totalCents,
  idempotencyKey: idempotencyKeySchema,
});
export type CashPaymentRequest = z.input<typeof cashPaymentSchema>;

/** FEE-08 — payment seen outside ReMix (bank statement, cheque). */
export const manualPaymentSchema = z.strictObject({
  studentId: z.uuid(),
  lineIds,
  kind: z.enum(MANUAL_PAYMENT_KINDS),
  reference: z.string().trim().min(1).max(80),
  receivedOn: dateSchema,
  note: z.string().trim().max(300).optional(),
  idempotencyKey: idempotencyKeySchema,
});
export type ManualPaymentRequest = z.input<typeof manualPaymentSchema>;

/** FEE-11 — owner only. */
export const reversePaymentSchema = z.strictObject({
  reason: z.string().trim().min(3).max(300),
});
export type ReversePaymentRequest = z.input<typeof reversePaymentSchema>;

export const listPaymentsQuerySchema = pageQuerySchema.extend({
  from: dateSchema.optional(),
  to: dateSchema.optional(),
  method: z.enum(PAYMENT_METHODS).optional(),
  studentId: z.uuid().optional(),
  needsRefund: z.enum(['true', 'false']).optional(),
});
export type ListPaymentsQuery = z.input<typeof listPaymentsQuerySchema>;

export const listPaymentsResponseSchema = pageMetaSchema.extend({ items: z.array(paymentSchema) });

/** Cash counter / profile Payments tab: what a student owes and has paid (FEE-07, FEE-10). */
export const studentFeesSchema = z.object({
  studentId: z.uuid(),
  studentNo: z.string(),
  displayName: z.string(),
  openLines: z.array(invoiceLineSchema),
  payments: z.array(paymentSchema),
});
export type StudentFees = z.infer<typeof studentFeesSchema>;

// ----- Receipts (FEE-09) ---------------------------------------------------------------------

export const receiptSchema = z.object({
  id: z.uuid(),
  number: z.string(),
  paymentId: z.uuid(),
  issuedAt: isoDateTime,
  method: z.enum(PAYMENT_METHODS),
  amountCents: totalCents,
  cashReceivedCents: totalCents.nullable(),
  changeCents: totalCents.nullable(),
  studentNo: z.string(),
  studentName: z.string(),
  lines: z.array(z.object({ className: z.string(), month: monthSchema, amountCents: cents })),
  reversedAt: isoDateTime.nullable(),
  /** Header/footer from the tenant's receipt template (80 mm print and PDF use the same data). */
  institute: z.object({
    name: z.string(),
    logoUrl: z.string().nullable(),
    address: z.string().nullable(),
    phone: z.string().nullable(),
    footer: z.string().nullable(),
  }),
});
export type Receipt = z.infer<typeof receiptSchema>;

/** Signed, short-lived download (ADR 0009). */
export const signedUrlSchema = z.object({ url: z.url(), expiresAt: isoDateTime });
export type SignedUrl = z.infer<typeof signedUrlSchema>;

// ----- Bank slips (FEE-05/06) ----------------------------------------------------------------

export const SLIP_STATUSES = [
  'processing',
  'submitted',
  'approved',
  'rejected',
  'superseded',
] as const;
export type SlipStatus = (typeof SLIP_STATUSES)[number];

export const SLIP_CONTENT_TYPES = ['image/jpeg', 'image/png', 'image/heic', 'image/heif'] as const;
export const SLIP_MAX_BYTES = 5 * 1024 * 1024;

export const slipUploadRequestSchema = z.strictObject({
  contentType: z.enum(SLIP_CONTENT_TYPES),
  sizeBytes: z.number().int().min(1).max(SLIP_MAX_BYTES),
});

/** Presigned PUT (≤ 10 min). The client must send exactly these headers. */
export const slipUploadResponseSchema = z.object({
  uploadId: z.uuid(),
  url: z.url(),
  headers: z.record(z.string(), z.string()),
  expiresAt: isoDateTime,
});
export type SlipUploadResponse = z.infer<typeof slipUploadResponseSchema>;

export const submitSlipSchema = z.strictObject({
  uploadId: z.uuid(),
  lineIds,
  /** As written on the slip. */
  amountCents: totalCents.min(1),
  reference: z.string().trim().min(3).max(40),
  slipDate: dateSchema,
});
export type SubmitSlipRequest = z.input<typeof submitSlipSchema>;

export const slipSchema = z.object({
  id: z.uuid(),
  status: z.enum(SLIP_STATUSES),
  studentId: z.uuid(),
  studentNo: z.string(),
  studentName: z.string(),
  submittedAt: isoDateTime,
  amountCents: totalCents,
  /** Open amount of the selected lines now. */
  expectedCents: totalCents,
  reference: z.string(),
  slipDate: dateSchema,
  lines: z.array(invoiceLineSchema),
  /** Same normalised reference + amount already approved in this tenant (rule 4). */
  duplicateOf: z
    .object({ slipId: z.uuid(), studentName: z.string(), approvedAt: isoDateTime })
    .nullable(),
  rejectReason: z.string().nullable(),
  reviewedByName: z.string().nullable(),
  reviewedAt: isoDateTime.nullable(),
});
export type Slip = z.infer<typeof slipSchema>;

/** Queue is oldest first. */
export const listSlipsQuerySchema = pageQuerySchema.extend({
  status: z.enum(SLIP_STATUSES).default('submitted'),
});
export const listSlipsResponseSchema = pageMetaSchema.extend({ items: z.array(slipSchema) });

export const approveSlipSchema = z.strictObject({
  /** Required when `duplicateOf` is set; audited. */
  confirmDuplicate: z.boolean().default(false),
});
export const rejectSlipSchema = z.strictObject({ reason: z.string().trim().min(3).max(200) });

// ----- Student Pay (FEE-03/04/10) ------------------------------------------------------------

export const myFeesResponseSchema = z.object({
  openLines: z.array(invoiceLineSchema),
  payments: z.array(paymentSchema.omit({ needsRefund: true, unallocatedCents: true })),
  slips: z.array(
    slipSchema.pick({
      id: true,
      status: true,
      submittedAt: true,
      amountCents: true,
      reference: true,
      rejectReason: true,
    }),
  ),
  cardEnabled: z.boolean(),
  /** Null when the institute has not set bank details (slip option hidden). */
  bankDetails: z
    .object({
      bankName: z.string(),
      branch: z.string(),
      accountNumber: z.string(),
      accountName: z.string(),
    })
    .nullable(),
});
export type MyFeesResponse = z.infer<typeof myFeesResponseSchema>;

export const createCheckoutSchema = z.strictObject({ lineIds });

/**
 * PayHere checkout: the browser POSTs `fields` to `actionUrl` (auto-submitted form). The hash is
 * computed server-side; the merchant secret never leaves the API (ADR 0008 §6).
 */
export const checkoutResponseSchema = z.object({
  checkoutId: z.uuid(),
  actionUrl: z.url(),
  fields: z.record(z.string(), z.string()),
});
export type CheckoutResponse = z.infer<typeof checkoutResponseSchema>;

export const CHECKOUT_STATUSES = ['pending', 'paid', 'failed', 'cancelled', 'expired'] as const;

/** Return page polls this; the redirect itself proves nothing. */
export const checkoutStatusSchema = z.object({
  checkoutId: z.uuid(),
  status: z.enum(CHECKOUT_STATUSES),
  receiptId: z.uuid().nullable(),
});

/**
 * PayHere `notify_url` body (application/x-www-form-urlencoded, all strings). Parsed by the
 * webhook controller only — not part of the typed client. Unknown fields are allowed: PayHere
 * may add some, and the signature covers the ones that matter.
 */
export const payhereNotifySchema = z.object({
  merchant_id: z.string().min(1).max(20),
  order_id: z.uuid(),
  payment_id: z.string().min(1).max(40),
  payhere_amount: z.string().regex(/^\d+\.\d{2}$/),
  payhere_currency: z.string().length(3),
  status_code: z.string().regex(/^-?\d$/),
  md5sig: z.string().regex(/^[A-Fa-f0-9]{32}$/),
});
export type PayhereNotify = z.infer<typeof payhereNotifySchema>;

// ----- Settings (SET-02/03, FEE-09 template, FEE-12) ------------------------------------------

export const PAYHERE_MODES = ['sandbox', 'live'] as const;

export const payhereSettingsSchema = z.object({
  enabled: z.boolean(),
  mode: z.enum(PAYHERE_MODES),
  merchantId: z.string().nullable(),
  /** "••••1a2b" or null; the secret itself is never returned. */
  secretHint: z.string().nullable(),
  lastTest: z.object({ at: isoDateTime, status: z.enum(CHECKOUT_STATUSES) }).nullable(),
});
export type PayhereSettings = z.infer<typeof payhereSettingsSchema>;

export const updatePayhereSettingsSchema = z.strictObject({
  enabled: z.boolean().optional(),
  mode: z.enum(PAYHERE_MODES).optional(),
  merchantId: z
    .string()
    .trim()
    .regex(/^\d{4,20}$/, 'Merchant ID is numeric')
    .optional(),
  /** Write-only; omit to keep the stored one. */
  merchantSecret: z.string().trim().min(8).max(200).optional(),
});
export type UpdatePayhereSettingsRequest = z.input<typeof updatePayhereSettingsSchema>;

export const bankDetailsSchema = z.strictObject({
  bankName: z.string().trim().min(2).max(80),
  branch: z.string().trim().min(2).max(80),
  accountNumber: z
    .string()
    .trim()
    .regex(/^[0-9 -]{6,24}$/, 'Digits only'),
  accountName: z.string().trim().min(2).max(120),
});

export const feeSettingsSchema = z.object({
  /** Day of the month fees are due (FEE-12; default 5). */
  dueDay: z.number().int().min(1).max(28),
  remindersEnabled: z.boolean(),
  /** MSG-04: text the guardian (or student) a receipt SMS for each payment; costs wallet credit. */
  receiptSmsEnabled: z.boolean(),
  remindBeforeDays: z.number().int().min(0).max(10),
  remindAfterDays: z.number().int().min(1).max(30),
  bankDetails: bankDetailsSchema.nullable(),
  receipt: z.object({
    address: z.string().max(200).nullable(),
    phone: z.string().max(40).nullable(),
    footer: z.string().max(200).nullable(),
  }),
});
export type FeeSettings = z.infer<typeof feeSettingsSchema>;

export const updateFeeSettingsSchema = z
  .strictObject({
    dueDay: feeSettingsSchema.shape.dueDay.optional(),
    remindersEnabled: z.boolean().optional(),
    receiptSmsEnabled: z.boolean().optional(),
    remindBeforeDays: feeSettingsSchema.shape.remindBeforeDays.optional(),
    remindAfterDays: feeSettingsSchema.shape.remindAfterDays.optional(),
    bankDetails: bankDetailsSchema.nullable().optional(),
    receipt: z
      .strictObject({
        address: z.string().trim().max(200).nullable().optional(),
        phone: z.string().trim().max(40).nullable().optional(),
        footer: z.string().trim().max(200).nullable().optional(),
      })
      .optional(),
  })
  .refine((s) => Object.keys(s).length > 0, 'Nothing to update');
export type UpdateFeeSettingsRequest = z.input<typeof updateFeeSettingsSchema>;

// ----- SMS wallet and reminders (MSG-02, FEE-02/12) -------------------------------------------

/** Price per SMS segment, from the add-on price list (never copied). */
export const SMS_SEGMENT_PRICE_CENTS = ADDONS.sms.price;

/** GSM-7 160/153, otherwise UCS-2 70/67 (Sinhala and Tamil are always UCS-2). */
export function smsSegments(text: string): number {
  // eslint-disable-next-line no-control-regex
  const gsm = /^[\n\r -~£¥èéùìòÇØøÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ¤¡ÄÖÑÜ§¿äöñüà]*$/.test(text);
  const [single, multi] = gsm ? [160, 153] : [70, 67];
  const length = gsm ? text.length : [...text].length;
  if (length === 0) return 0;
  return length <= single ? 1 : Math.ceil(length / multi);
}

export const SMS_LEDGER_KINDS = ['top_up', 'send', 'refund', 'adjustment'] as const;

export const smsWalletSchema = z.object({
  balanceCents: z.number().int(),
  senderId: z.string().nullable(),
  lowBalanceThresholdCents: cents,
  /** Balance is under the threshold: show the "top up" warning (MSG-02 low-balance alert). */
  lowBalance: z.boolean(),
  /** A "Buy SMS" request is waiting for Recca staff (at most a few open at once). */
  openTopUpRequests: z.number().int().nonnegative(),
  segmentPriceCents: cents,
  recent: z.array(
    z.object({
      id: z.uuid(),
      kind: z.enum(SMS_LEDGER_KINDS),
      amountCents: z.number().int(),
      balanceAfterCents: z.number().int(),
      note: z.string().nullable(),
      at: isoDateTime,
    }),
  ),
});
export type SmsWallet = z.infer<typeof smsWalletSchema>;

/** "Buy SMS": a request Recca staff invoice and credit (platform billing is Phase 7). */
export const smsTopUpRequestSchema = z.strictObject({ amountCents: cents.min(100_000) });

/** FEE-02 "Send reminder SMS to N unpaid" — preview first, then send with the same body. */
export const reminderTargetSchema = z.strictObject({
  month: monthSchema,
  filter: z.enum(['unpaid', 'overdue']),
  classId: z.uuid().optional(),
});
export type ReminderTarget = z.input<typeof reminderTargetSchema>;

export const reminderPreviewSchema = z.object({
  recipients: z.number().int().nonnegative(),
  segments: z.number().int().nonnegative(),
  costCents: totalCents,
  balanceCents: z.number().int(),
  sampleText: z.string(),
});
export type ReminderPreview = z.infer<typeof reminderPreviewSchema>;

export const sendRemindersSchema = reminderTargetSchema.extend({
  idempotencyKey: idempotencyKeySchema,
});
export type SendRemindersRequest = z.output<typeof sendRemindersSchema>;
export const sendRemindersResponseSchema = z.object({
  queued: z.number().int().nonnegative(),
  costCents: totalCents,
});
export type SendRemindersResponse = z.infer<typeof sendRemindersResponseSchema>;
