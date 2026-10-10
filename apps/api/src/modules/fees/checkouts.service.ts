import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { schema, withTenant, type Db, type Tx } from '@remix/db';
import {
  payhereNotifySchema,
  type CHECKOUT_STATUSES,
  type CheckoutResponse,
  type checkoutStatusSchema,
  type PayhereNotify,
} from '@remix/types/api';
import type { z } from 'zod';
import type { AuthSession } from '../../common/auth/session-authenticator';
import { AppException } from '../../common/errors/app-exception';
import { CLOCK, type Clock } from '../../common/time/clock';
import type { ResolvedTenant } from '../../common/tenant/tenant-resolver';
import {
  PAYMENT_PROVIDER,
  type PayHereMerchantConfig,
  type PaymentProvider,
  type VerifiedPaymentNotification,
} from '../../integrations/payment/payment.provider';
import { SecretBox } from '../../integrations/secret-box';
import { AuditService } from '../audit/audit.service';
import { DB } from '../db/db.module';
import { FeesHooks } from './fees-hooks';
import { lockLedger, recordPayment, type RecordedPayment } from './ledger';
import { lockMoneySettings } from './payhere-settings.service';
import { safeCents } from './projections';

const {
  payhereCheckouts,
  payhereCheckoutLines,
  invoiceLines,
  invoices,
  paymentAllocations,
  receipts,
  tenantIntegrations,
  tenantSettings,
  tenantUsers,
} = schema;
type CheckoutRow = typeof payhereCheckouts.$inferSelect;
type CheckoutStatus = z.infer<typeof checkoutStatusSchema>;
type CheckoutState = (typeof CHECKOUT_STATUSES)[number];

/** A signed order is accepted by us for this long; a later success is still recorded. */
export const CHECKOUT_TTL_MS = 30 * 60 * 1000;
/** SET-02 "Test payment (LKR 10)". */
export const TEST_AMOUNT_CENTS = 1000;
/** PayHere requires address and city; tuition has no delivery address to give. */
const NO_ADDRESS = 'Not applicable (tuition fees)';

const checkoutNotFound = () => new AppException('NOT_FOUND', 404, 'Payment not found');
const cardUnavailable = () =>
  new AppException('PAYMENT_PROVIDER_UNAVAILABLE', 409, 'Card payments are not available');
/** One generic answer for every rejected notification: nothing about why. */
const notifyRejected = (status: 400 | 403) =>
  new AppException(
    status === 400 ? 'VALIDATION_FAILED' : 'FORBIDDEN',
    status,
    'Notification rejected',
  );

interface Merchant {
  rowId: string;
  enabled: boolean;
  config: PayHereMerchantConfig;
  mode: 'sandbox' | 'live';
}

export type NotifyOutcome =
  'paid' | 'replayed' | 'status' | 'chargeback' | 'ignored' | 'unknown_order' | 'mismatch';

/**
 * FEE-04 card payments and the SET-02 test payment through PayHere (ADR 0008 §6). The browser
 * redirect proves nothing: only a notification whose signature verifies with the tenant's own
 * merchant secret, and whose merchant, amount and currency equal the stored order, moves money.
 */
@Injectable()
export class CheckoutsService {
  private readonly logger = new Logger('PayHere');

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(PAYMENT_PROVIDER) private readonly provider: PaymentProvider,
    private readonly secrets: SecretBox,
    private readonly audit: AuditService,
    private readonly hooks: FeesHooks,
  ) {}

  // ----- Student (FEE-04) ---------------------------------------------------------------------

  /** A checkout for whole open months of the signed-in student; amount = their open total. */
  async create(
    tenant: ResolvedTenant,
    session: AuthSession,
    lineIdsIn: readonly string[],
    origin: string,
  ): Promise<CheckoutResponse> {
    const studentId = studentOf(session, tenant.id);
    const lineIds = [...new Set(lineIdsIn)];
    if (lineIds.length !== lineIdsIn.length)
      throw new AppException('VALIDATION_FAILED', 400, 'Choose each month once');
    const now = this.clock.now();
    return withTenant(this.db, tenant.id, async (tx) => {
      // Same lock as every payment path: the open amounts cannot change under us.
      await lockLedger(tx);
      const merchant = await this.merchant(tx, tenant.id);
      if (!merchant?.enabled) throw cardUnavailable();
      const open = await openLines(tx, lineIds);
      if (open.length !== lineIds.length || open.some((l) => l.studentId !== studentId || l.voided))
        throw new AppException('NOT_FOUND', 404, 'Fee month not found');
      if (open.some((l) => l.openCents <= 0))
        throw new AppException('ALREADY_PAID', 409, 'A selected month is already paid');
      const amountCents = safeCents(open.reduce((n, l) => n + l.openCents, 0));
      const checkout = await this.insertCheckout(tx, tenant.id, {
        kind: 'fees',
        studentId,
        createdBy: studentId,
        amountCents,
        merchant,
        now,
      });
      await tx.execute(sql`insert into payhere_checkout_lines (tenant_id, checkout_id, invoice_line_id)
        select ${tenant.id}::uuid, ${checkout.id}::uuid, line::uuid from unnest(${sql.param(lineIds)}::text[]) as line`);
      const [student] = await tx.select().from(tenantUsers).where(eq(tenantUsers.id, studentId));
      const [settings] = await tx.select().from(tenantSettings);
      if (!student?.phone) throw checkoutNotFound();
      const months = [...new Set(open.map((l) => l.month.slice(0, 7)))].sort();
      const [firstName = '', ...rest] = student.displayName.trim().split(/\s+/);
      await this.audit.record(tx, tenant.id, {
        action: 'checkout.create',
        actorId: studentId,
        actorKind: 'student',
        at: now,
        entity: 'payhere_checkout',
        entityId: checkout.id,
        after: { amountCents, lines: lineIds.length, mode: merchant.mode },
      });
      return this.sign(merchant, checkout, tenant, origin, {
        description: `Tuition fees ${months.join(', ')}`.slice(0, 100),
        returnPath: `/app/pay/return?checkout=${checkout.id}`,
        cancelPath: `/app/pay/cancel?checkout=${checkout.id}`,
        customer: {
          firstName: firstName || student.displayName,
          lastName: rest.join(' ') || '-',
          phone: student.phone,
          ...(student.email ? { email: student.email } : {}),
          address: settings?.receiptAddress?.trim() || NO_ADDRESS,
          city: NO_ADDRESS,
        },
        tag: 'fees',
      });
    });
  }

  /** The return page polls this. A pending order past its expiry reads as `expired`. */
  async status(tenantId: string, session: AuthSession, id: string): Promise<CheckoutStatus> {
    const studentId = studentOf(session, tenantId);
    const now = this.clock.now();
    return withTenant(this.db, tenantId, async (tx) => {
      const [row] = await tx
        .select()
        .from(payhereCheckouts)
        .where(and(eq(payhereCheckouts.id, id), eq(payhereCheckouts.studentId, studentId)));
      if (!row) throw checkoutNotFound();
      let status = row.status;
      if (status === 'pending' && row.expiresAt <= now) {
        // Conditional update: a notify that committed meanwhile wins.
        const expired = await tx
          .update(payhereCheckouts)
          .set({ status: 'expired' })
          .where(and(eq(payhereCheckouts.id, id), eq(payhereCheckouts.status, 'pending')))
          .returning({ status: payhereCheckouts.status });
        status = expired[0]?.status ?? (await this.reload(tx, id)).status;
      }
      const paymentId = status === 'paid' ? (await this.reload(tx, id)).paymentId : null;
      const [receipt] = paymentId
        ? await tx
            .select({ id: receipts.id })
            .from(receipts)
            .where(eq(receipts.paymentId, paymentId))
        : [];
      return { checkoutId: row.id, status, receiptId: receipt?.id ?? null };
    });
  }

  // ----- Owner test payment (SET-02) ---------------------------------------------------------

  /**
   * A signed LKR 10 order paid by the owner, not tied to a student and never entered in the
   * ledger. `lastTest` goes to `pending` now and follows the verified notification.
   */
  async createTest(
    tenant: ResolvedTenant,
    session: AuthSession,
    origin: string,
  ): Promise<CheckoutResponse> {
    if (session.kind !== 'staff' || session.tenantId !== tenant.id)
      throw new AppException('FORBIDDEN', 403);
    const now = this.clock.now();
    return withTenant(this.db, tenant.id, async (tx) => {
      await lockMoneySettings(tx, tenant.id);
      const merchant = await this.merchant(tx, tenant.id);
      if (!merchant)
        throw new AppException(
          'VALIDATION_FAILED',
          400,
          'Set the merchant ID and secret before testing',
        );
      const [owner] = await tx.select().from(tenantUsers).where(eq(tenantUsers.id, session.userId));
      const [settings] = await tx.select().from(tenantSettings);
      if (!owner) throw checkoutNotFound();
      if (!owner.email || !owner.phone) {
        throw new AppException(
          'VALIDATION_FAILED',
          400,
          'Add an email and phone to your profile before testing PayHere',
        );
      }
      const checkout = await this.insertCheckout(tx, tenant.id, {
        kind: 'test',
        studentId: null,
        createdBy: owner.id,
        amountCents: TEST_AMOUNT_CENTS,
        merchant,
        now,
      });
      await this.setLastTest(tx, merchant.rowId, now, 'pending');
      await this.audit.record(tx, tenant.id, {
        action: 'settings.payhere_test',
        actorId: owner.id,
        actorKind: 'staff',
        at: now,
        entity: 'payhere_checkout',
        entityId: checkout.id,
        after: { amountCents: TEST_AMOUNT_CENTS, mode: merchant.mode },
      });
      const [firstName = '', ...rest] = owner.displayName.trim().split(/\s+/);
      return this.sign(merchant, checkout, tenant, origin, {
        description: 'ReMix PayHere test payment',
        returnPath: '/admin/settings/payments',
        cancelPath: '/admin/settings/payments',
        customer: {
          firstName: firstName || owner.displayName,
          lastName: rest.join(' ') || '-',
          phone: owner.phone,
          email: owner.email,
          address: settings?.receiptAddress?.trim() || 'Not applicable (integration test)',
          city: 'Not applicable (integration test)',
        },
        tag: 'settings-test',
      });
    });
  }

  // ----- Notify webhook ----------------------------------------------------------------------

  /**
   * `POST /api/v1/webhooks/payhere/:tenantSlug`. Throws (400/403, generic) only when the body is
   * malformed or the signature does not verify; every verified notification is answered 200.
   */
  async notify(tenant: ResolvedTenant, body: unknown): Promise<NotifyOutcome> {
    const now = this.clock.now();
    const parsed = payhereNotifySchema.safeParse(body);
    if (!parsed.success) {
      await this.rejected(tenant.id, now, 'malformed', null);
      throw notifyRejected(400);
    }
    const payload = parsed.data;
    const verified = await withTenant(this.db, tenant.id, async (tx) => {
      const merchant = await this.merchant(tx, tenant.id);
      if (!merchant) return null;
      return this.provider.verifyNotification({
        tenantId: tenant.id,
        merchant: merchant.config,
        payload: signedFields(payload),
      });
    });
    if (!verified || verified.orderId !== payload.order_id) {
      await this.rejected(tenant.id, now, 'signature', payload.order_id);
      throw notifyRejected(403);
    }

    const result = await withTenant(this.db, tenant.id, async (tx) => {
      await lockLedger(tx);
      const [checkout] = await tx
        .select()
        .from(payhereCheckouts)
        .where(eq(payhereCheckouts.id, verified.orderId))
        .for('update');
      if (!checkout) {
        await this.recordNotify(tx, tenant.id, now, 'payhere.notify_rejected', verified, {
          reason: 'unknown_order',
        });
        return { outcome: 'unknown_order' as const, recorded: null };
      }
      if (
        checkout.merchantId !== payload.merchant_id ||
        checkout.currency !== verified.currency ||
        checkout.amountCents !== verified.amountCents
      ) {
        await this.recordNotify(tx, tenant.id, now, 'payhere.notify_rejected', verified, {
          reason: 'mismatch',
          merchant: checkout.merchantId === payload.merchant_id,
          currency: checkout.currency === verified.currency,
          amount: checkout.amountCents === verified.amountCents,
        });
        return { outcome: 'mismatch' as const, recorded: null };
      }
      return this.apply(tx, tenant.id, checkout, verified, Number(payload.status_code), now);
    });
    if (result.recorded?.receiptId && !result.recorded.replayed) {
      await this.hooks.onPaymentCommitted({
        tenantId: tenant.id,
        paymentId: result.recorded.payment.id,
        receiptId: result.recorded.receiptId,
        jobKey: `receipt:${tenant.id}:${result.recorded.payment.id}`,
      });
    }
    this.logger.log(
      { tenantId: tenant.id, checkoutId: verified.orderId, outcome: result.outcome },
      'PayHere notification',
    );
    return result.outcome;
  }

  /** The state change for a verified, matching notification. Runs under the ledger + row lock. */
  private async apply(
    tx: Tx,
    tenantId: string,
    checkout: CheckoutRow,
    n: VerifiedPaymentNotification,
    statusCode: number,
    now: Date,
  ): Promise<{ outcome: NotifyOutcome; recorded: RecordedPayment | null }> {
    const base = { statusCode, notifiedAt: now };
    const notice = (outcome: NotifyOutcome, extra: Record<string, unknown> = {}) =>
      this.recordNotify(tx, tenantId, now, 'payhere.notify', n, {
        kind: checkout.kind,
        outcome,
        ...extra,
      });

    if (n.status === 'success') {
      if (checkout.status === 'paid') {
        await notice('replayed');
        return { outcome: 'replayed', recorded: null };
      }
      const late = checkout.status !== 'pending' || checkout.expiresAt <= now;
      let recorded: RecordedPayment | null = null;
      if (checkout.kind === 'fees') {
        if (!checkout.studentId) throw new Error('Fees checkout without a student');
        const lines = await tx
          .select({ id: payhereCheckoutLines.invoiceLineId })
          .from(payhereCheckoutLines)
          .where(eq(payhereCheckoutLines.checkoutId, checkout.id));
        // ADR 0008 §6: whatever was paid another way meanwhile stays unallocated (needs_refund).
        recorded = await recordPayment(
          tx,
          {
            method: 'card',
            amountCents: checkout.amountCents,
            lines: lines.map((l) => l.id),
            idempotencyKey: `payhere:${checkout.id}`,
            receivedBy: null,
            studentId: checkout.studentId,
            providerRef: n.providerPaymentId,
          },
          now,
          this.audit,
        );
      } else {
        await this.setLastTestFor(tx, tenantId, now, 'paid');
      }
      await tx
        .update(payhereCheckouts)
        .set({
          ...base,
          status: 'paid',
          providerPaymentId: n.providerPaymentId,
          ...(recorded ? { paymentId: recorded.payment.id } : {}),
        })
        .where(eq(payhereCheckouts.id, checkout.id));
      await notice('paid', {
        late,
        ...(recorded
          ? { paymentId: recorded.payment.id, unallocatedCents: recorded.payment.unallocatedCents }
          : {}),
      });
      return { outcome: 'paid', recorded };
    }

    if (n.status === 'chargedback') {
      if (checkout.status === 'paid' && !checkout.chargebackAt) {
        // Flag for the owner; no automatic reversal (FEE-11 reversals stay a human decision).
        await tx
          .update(payhereCheckouts)
          .set({ ...base, chargebackAt: now })
          .where(eq(payhereCheckouts.id, checkout.id));
        await this.recordNotify(tx, tenantId, now, 'payhere.chargeback', n, {
          kind: checkout.kind,
          paymentId: checkout.paymentId,
        });
        return { outcome: 'chargeback', recorded: null };
      }
      await notice('ignored', { status: n.status });
      return { outcome: 'ignored', recorded: null };
    }

    // pending | cancelled | failed: never overrides a paid order, never moves back to pending.
    const next = n.status === 'pending' ? 'pending' : n.status;
    if (checkout.status === 'paid' || (next === 'pending' && checkout.status !== 'pending')) {
      await notice('ignored', { status: n.status });
      return { outcome: 'ignored', recorded: null };
    }
    await tx
      .update(payhereCheckouts)
      .set({ ...base, status: next })
      .where(eq(payhereCheckouts.id, checkout.id));
    if (checkout.kind === 'test') await this.setLastTestFor(tx, tenantId, now, next);
    await notice('status', { status: next });
    return { outcome: 'status', recorded: null };
  }

  // ----- Helpers -----------------------------------------------------------------------------

  /** The tenant's PayHere merchant with its decrypted secret; null when not configured. */
  private async merchant(tx: Tx, tenantId: string): Promise<Merchant | null> {
    const [row] = await tx
      .select()
      .from(tenantIntegrations)
      .where(eq(tenantIntegrations.kind, 'payhere'));
    if (!row?.config.merchantId || !row.secretCiphertext || !row.secretNonce || !row.keyId)
      return null;
    const mode = row.config.mode === 'live' ? 'live' : 'sandbox';
    return {
      rowId: row.id,
      enabled: row.config.enabled,
      mode,
      config: {
        provider: 'payhere',
        merchantId: row.config.merchantId,
        merchantSecret: this.secrets.open(tenantId, {
          secretCiphertext: row.secretCiphertext,
          secretNonce: row.secretNonce,
          keyId: row.keyId,
        }),
        sandbox: mode === 'sandbox',
      },
    };
  }

  private async insertCheckout(
    tx: Tx,
    tenantId: string,
    c: {
      kind: 'fees' | 'test';
      studentId: string | null;
      createdBy: string;
      amountCents: number;
      merchant: Merchant;
      now: Date;
    },
  ): Promise<CheckoutRow> {
    // Named columns only (the id default is not an insertable column for the app role).
    const inserted = await tx.execute<{ id: string }>(sql`
      insert into payhere_checkouts (tenant_id, kind, student_id, created_by, amount_cents, currency, merchant_id, mode, created_at, expires_at)
      values (${tenantId}, ${c.kind}, ${c.studentId}, ${c.createdBy}, ${c.amountCents}, 'LKR',
        ${c.merchant.config.merchantId}, ${c.merchant.mode}, ${c.now.toISOString()},
        ${new Date(c.now.getTime() + CHECKOUT_TTL_MS).toISOString()})
      returning id`);
    const id = inserted.rows[0]?.id;
    if (!id) throw new Error('Checkout not inserted');
    return this.reload(tx, id);
  }

  private async reload(tx: Tx, id: string): Promise<CheckoutRow> {
    const [row] = await tx.select().from(payhereCheckouts).where(eq(payhereCheckouts.id, id));
    if (!row) throw checkoutNotFound();
    return row;
  }

  private async sign(
    merchant: Merchant,
    checkout: CheckoutRow,
    tenant: ResolvedTenant,
    origin: string,
    o: {
      description: string;
      returnPath: string;
      cancelPath: string;
      customer: {
        firstName: string;
        lastName: string;
        phone: string;
        email?: string;
        address: string;
        city: string;
      };
      tag: string;
    },
  ): Promise<CheckoutResponse> {
    const session = await this.provider.createCheckout({
      tenantId: tenant.id,
      merchant: merchant.config,
      orderId: checkout.id,
      amountCents: checkout.amountCents,
      currency: 'LKR',
      description: o.description,
      customer: o.customer,
      returnUrl: `${origin}${o.returnPath}`,
      cancelUrl: `${origin}${o.cancelPath}`,
      notifyUrl: `${origin}/api/v1/webhooks/payhere/${tenant.slug}`,
      idempotencyKey: checkout.id,
      tag: o.tag,
    });
    return { checkoutId: checkout.id, actionUrl: session.actionUrl, fields: session.fields };
  }

  private async setLastTest(
    tx: Tx,
    rowId: string,
    now: Date,
    status: CheckoutState,
  ): Promise<void> {
    const [row] = await tx
      .select()
      .from(tenantIntegrations)
      .where(eq(tenantIntegrations.id, rowId));
    if (!row) return;
    await tx
      .update(tenantIntegrations)
      .set({ config: { ...row.config, lastTest: { at: now.toISOString(), status } } })
      .where(eq(tenantIntegrations.id, rowId));
  }

  private async setLastTestFor(
    tx: Tx,
    tenantId: string,
    now: Date,
    status: CheckoutState,
  ): Promise<void> {
    await lockMoneySettings(tx, tenantId);
    const [row] = await tx
      .select({ id: tenantIntegrations.id })
      .from(tenantIntegrations)
      .where(eq(tenantIntegrations.kind, 'payhere'));
    if (row) await this.setLastTest(tx, row.id, now, status);
  }

  /** Audit of a verified notification: ids, codes and amounts only — never the payload. */
  private recordNotify(
    tx: Tx,
    tenantId: string,
    now: Date,
    action: 'payhere.notify' | 'payhere.notify_rejected' | 'payhere.chargeback',
    n: VerifiedPaymentNotification,
    extra: Record<string, unknown>,
  ): Promise<void> {
    return this.audit.record(tx, tenantId, {
      action,
      actorId: null,
      actorKind: 'system',
      at: now,
      entity: 'payhere_checkout',
      entityId: n.orderId,
      after: {
        providerPaymentId: n.providerPaymentId,
        status: n.status,
        amountCents: n.amountCents,
        ...extra,
      },
    });
  }

  /** Malformed or forged: audited in its own transaction, logged without the body. */
  private async rejected(
    tenantId: string,
    now: Date,
    reason: 'malformed' | 'signature',
    orderId: string | null,
  ) {
    this.logger.warn({ tenantId, reason }, 'PayHere notification rejected');
    await withTenant(this.db, tenantId, (tx) =>
      this.audit.record(tx, tenantId, {
        action: 'payhere.notify_rejected',
        actorId: null,
        actorKind: 'system',
        at: now,
        entity: 'payhere_checkout',
        entityId: orderId,
        after: { reason },
      }),
    );
  }
}

/** Only the fields the signature covers (plus the payment id) reach the provider. */
function signedFields(p: PayhereNotify): Record<string, string> {
  return {
    merchant_id: p.merchant_id,
    order_id: p.order_id,
    payment_id: p.payment_id,
    payhere_amount: p.payhere_amount,
    payhere_currency: p.payhere_currency,
    status_code: p.status_code,
    md5sig: p.md5sig,
  };
}

function studentOf(session: AuthSession, tenantId: string): string {
  if (session.kind !== 'student' || session.tenantId !== tenantId)
    throw new AppException('FORBIDDEN', 403);
  return session.userId;
}

interface OpenLine {
  id: string;
  studentId: string;
  month: string;
  voided: boolean;
  openCents: number;
}

/** Selected lines with their owner and open balance, locked like every ledger path. */
async function openLines(tx: Tx, lineIds: readonly string[]): Promise<OpenLine[]> {
  if (!lineIds.length) return [];
  const rows = await tx
    .select({
      id: invoiceLines.id,
      studentId: invoices.studentId,
      month: invoiceLines.month,
      voidedAt: invoiceLines.voidedAt,
      amountCents: invoiceLines.amountCents,
    })
    .from(invoiceLines)
    .innerJoin(
      invoices,
      and(eq(invoices.tenantId, invoiceLines.tenantId), eq(invoices.id, invoiceLines.invoiceId)),
    )
    .where(inArray(invoiceLines.id, [...lineIds]))
    .orderBy(asc(invoiceLines.month), asc(invoiceLines.id))
    .for('update', { of: invoiceLines });
  const sums = await tx
    .select({
      id: paymentAllocations.invoiceLineId,
      paid: sql<string>`sum(${paymentAllocations.amountCents})`,
    })
    .from(paymentAllocations)
    .where(inArray(paymentAllocations.invoiceLineId, [...lineIds]))
    .groupBy(paymentAllocations.invoiceLineId);
  const paid = new Map(sums.map((s) => [s.id, safeCents(s.paid)]));
  return rows.map((r) => ({
    id: r.id,
    studentId: r.studentId,
    month: r.month,
    voided: r.voidedAt !== null,
    openCents: r.voidedAt ? 0 : Math.max(0, r.amountCents - (paid.get(r.id) ?? 0)),
  }));
}
