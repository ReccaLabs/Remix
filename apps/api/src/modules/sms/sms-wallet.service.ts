import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, count, desc, eq, inArray, sql } from 'drizzle-orm';
import { schema, withTenant, type Db, type Tx } from '@remix/db';
import { SMS_SEGMENT_PRICE_CENTS, type SmsWallet } from '@remix/types/api';
import type { AuthSession } from '../../common/auth/session-authenticator';
import { AppException } from '../../common/errors/app-exception';
import { CLOCK, type Clock } from '../../common/time/clock';
import { AuditService } from '../audit/audit.service';
import { DB } from '../db/db.module';

const { smsWallets, smsMessages, smsWalletLedger, smsTopUpRequests } = schema;

// The app role holds column-level INSERT grants on these tables (migration 0020), and Drizzle's
// insert names every column, so inserts here are explicit SQL naming only the granted columns.

/** Wallet default until Recca staff set one (LKR 200, about 210 messages). */
export const DEFAULT_LOW_BALANCE_CENTS = 20_000;
/** A tenant may have a few "Buy SMS" requests waiting; more is a sign of a stuck UI or abuse. */
export const MAX_OPEN_TOP_UP_REQUESTS = 3;
const RECENT_ENTRIES = 20;

/** The wallet cannot cover the message(s); nothing was debited. */
export class InsufficientSmsBalanceError extends Error {
  constructor(
    readonly balanceCents: number,
    readonly requiredCents: number,
  ) {
    super('Insufficient SMS wallet balance');
    this.name = 'InsufficientSmsBalanceError';
  }
}

export interface MessageToCharge {
  messageId: string;
  template: string;
  segments: number;
}

export interface Charge {
  messageId: string;
  costCents: number;
  /** False when this message id was already charged (an idempotent replay). */
  created: boolean;
}

/**
 * MSG-02 wallet. The ledger is append-only and its trigger (migration 0020) is the real
 * guardian of the balance; this service adds the idempotency (`sms_messages` unique per
 * message id), a friendly pre-check under the same row lock, the low-balance flag and the reads.
 * Every method that changes money runs inside one `withTenant` transaction.
 */
@Injectable()
export class SmsWalletService {
  private readonly logger = new Logger('SmsWallet');

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly audit: AuditService,
  ) {}

  async wallet(tenantId: string): Promise<SmsWallet> {
    return withTenant(this.db, tenantId, async (tx) => {
      const [wallet] = await tx.select().from(smsWallets);
      const recent = await tx
        .select()
        .from(smsWalletLedger)
        .orderBy(desc(smsWalletLedger.createdAt), desc(smsWalletLedger.id))
        .limit(RECENT_ENTRIES);
      const [open] = await tx
        .select({ n: count() })
        .from(smsTopUpRequests)
        .where(eq(smsTopUpRequests.status, 'requested'));
      const balance = wallet?.balanceCents ?? 0;
      const threshold = wallet?.lowBalanceThresholdCents ?? DEFAULT_LOW_BALANCE_CENTS;
      return {
        balanceCents: balance,
        senderId: wallet?.senderId ?? null,
        lowBalanceThresholdCents: threshold,
        lowBalance: balance < threshold,
        openTopUpRequests: open?.n ?? 0,
        segmentPriceCents: SMS_SEGMENT_PRICE_CENTS,
        recent: recent.map((e) => ({
          id: e.id,
          kind: e.kind as SmsWallet['recent'][number]['kind'],
          amountCents: e.amountCents,
          balanceAfterCents: e.balanceAfterCents,
          note: e.note,
          at: e.createdAt.toISOString(),
        })),
      };
    });
  }

  /** "Buy SMS": files a request that Recca staff invoice and credit (`pnpm tenant:sms-credit`). */
  async requestTopUp(
    tenantId: string,
    session: AuthSession,
    amountCents: number,
  ): Promise<void> {
    return withTenant(this.db, tenantId, async (tx) => {
      const [open] = await tx
        .select({ n: count() })
        .from(smsTopUpRequests)
        .where(eq(smsTopUpRequests.status, 'requested'));
      if ((open?.n ?? 0) >= MAX_OPEN_TOP_UP_REQUESTS) {
        throw new AppException(
          'CONFLICT',
          409,
          'You already have SMS top-up requests waiting for ReMix',
        );
      }
      const created = await tx.execute<{ id: string }>(sql`insert into sms_top_up_requests (tenant_id, amount_cents, requested_by)
        values (${tenantId}, ${amountCents}, ${session.userId}) returning id`);
      const row = created.rows[0];
      await this.audit.record(tx, tenantId, {
        actorId: session.userId,
        actorKind: 'staff',
        action: 'sms.top_up_request',
        entity: 'sms_wallet',
        entityId: row?.id ?? null,
        after: { amountCents },
        at: this.clock.now(),
      });
    });
  }

  /** Lock the wallet row (creating it on first use) and return its balance. */
  async lockWallet(tx: Tx, tenantId: string): Promise<number> {
    await tx.execute(sql`insert into sms_wallets (tenant_id) values (${tenantId}) on conflict (tenant_id) do nothing`);
    const [row] = await tx.select({ balance: smsWallets.balanceCents }).from(smsWallets).for('update');
    return row?.balance ?? 0;
  }

  /**
   * Debit one message inside the caller's transaction: records the message (the idempotency
   * key) and a `send` ledger entry of `segments x price`. An already-charged id changes nothing.
   * Throws {@link InsufficientSmsBalanceError} before writing anything for this message.
   */
  async charge(tx: Tx, tenantId: string, message: MessageToCharge): Promise<Charge> {
    const costCents = message.segments * SMS_SEGMENT_PRICE_CENTS;
    const inserted = await tx.execute<{ id: string }>(sql`insert into sms_messages (tenant_id, message_id, template, segments, cost_cents)
      values (${tenantId}, ${message.messageId}, ${message.template}, ${message.segments}, ${costCents})
      on conflict (tenant_id, message_id) do nothing returning id`);
    if (inserted.rows.length === 0) {
      const [existing] = await tx
        .select({ costCents: smsMessages.costCents })
        .from(smsMessages)
        .where(eq(smsMessages.messageId, message.messageId));
      return { messageId: message.messageId, costCents: existing?.costCents ?? costCents, created: false };
    }
    const balance = await this.lockWallet(tx, tenantId);
    if (balance < costCents) throw new InsufficientSmsBalanceError(balance, costCents);
    await tx.execute(sql`insert into sms_wallet_ledger (tenant_id, kind, amount_cents, message_id, segments, created_at)
      values (${tenantId}, 'send', ${-costCents}, ${message.messageId}, ${message.segments}, ${this.clock.now()})`);
    return { messageId: message.messageId, costCents, created: true };
  }

  /**
   * All-or-nothing debit of several messages: when the wallet cannot cover the new ones, nothing
   * is written (FEE-02 "409 INSUFFICIENT_BALANCE and nothing is queued").
   */
  async chargeAll(tx: Tx, tenantId: string, messages: readonly MessageToCharge[]): Promise<Charge[]> {
    if (messages.length === 0) return [];
    const balance = await this.lockWallet(tx, tenantId);
    const known = await tx
      .select({ messageId: smsMessages.messageId })
      .from(smsMessages)
      .where(inArray(smsMessages.messageId, messages.map((m) => m.messageId)));
    const knownIds = new Set(known.map((k) => k.messageId));
    const required = messages
      .filter((m) => !knownIds.has(m.messageId))
      .reduce((sum, m) => sum + m.segments * SMS_SEGMENT_PRICE_CENTS, 0);
    if (balance < required) throw new InsufficientSmsBalanceError(balance, required);
    const charges: Charge[] = [];
    for (const message of messages) charges.push(await this.charge(tx, tenantId, message));
    return charges;
  }

  /**
   * After a debit: flag the wallet once when it fell under its threshold (the response of
   * `smsWallet` shows it) and leave one audit row plus a warning log for staff to act on.
   */
  async noteLowBalance(tx: Tx, tenantId: string): Promise<void> {
    const [wallet] = await tx.select().from(smsWallets);
    if (!wallet || wallet.lowBalanceAlertedAt || wallet.balanceCents >= wallet.lowBalanceThresholdCents) return;
    const at = this.clock.now();
    const flagged = await tx
      .update(smsWallets)
      .set({ lowBalanceAlertedAt: at })
      .where(and(eq(smsWallets.tenantId, tenantId), sql`${smsWallets.lowBalanceAlertedAt} is null`))
      .returning({ id: smsWallets.id });
    if (flagged.length === 0) return;
    await this.audit.record(tx, tenantId, {
      actorId: null,
      actorKind: 'system',
      action: 'sms.low_balance',
      entity: 'sms_wallet',
      entityId: wallet.id,
      after: { balanceCents: wallet.balanceCents, thresholdCents: wallet.lowBalanceThresholdCents },
      at,
    });
    this.logger.warn({ tenantId, balanceCents: wallet.balanceCents }, 'SMS wallet is under its low-balance threshold');
  }

  /** The tenant's registered sender mask override, if staff set one. */
  async senderId(tx: Tx): Promise<string | null> {
    const [row] = await tx.select({ senderId: smsWallets.senderId }).from(smsWallets);
    return row?.senderId ?? null;
  }

  /** Move queued messages forward (a no-op for ones the worker already finished). */
  async markQueued(tenantId: string, messageIds: readonly string[]): Promise<void> {
    if (messageIds.length === 0) return;
    await withTenant(this.db, tenantId, (tx) =>
      tx
        .update(smsMessages)
        .set({ status: 'queued' })
        .where(and(inArray(smsMessages.messageId, [...messageIds]), eq(smsMessages.status, 'pending'))),
    );
  }

  /**
   * Give a message's money back and mark it failed. Safe to call twice and from several places
   * (worker on permanent failure, API when the queue is down, the stale-pending sweep): a
   * delivered message is never refunded, and the unique (message, refund) key stops doubles.
   */
  async refund(tenantId: string, messageId: string): Promise<boolean> {
    return withTenant(this.db, tenantId, async (tx) => {
      const [message] = await tx
        .select({ status: smsMessages.status })
        .from(smsMessages)
        .where(eq(smsMessages.messageId, messageId))
        .for('update');
      if (!message || message.status === 'sent' || message.status === 'failed') return false;
      const [send] = await tx
        .select({ amountCents: smsWalletLedger.amountCents, segments: smsWalletLedger.segments })
        .from(smsWalletLedger)
        .where(and(eq(smsWalletLedger.messageId, messageId), eq(smsWalletLedger.kind, 'send')));
      if (send) {
        await this.lockWallet(tx, tenantId);
        await tx.execute(sql`insert into sms_wallet_ledger (tenant_id, kind, amount_cents, message_id, segments, created_at)
          values (${tenantId}, 'refund', ${-send.amountCents}, ${messageId}, ${send.segments}, ${this.clock.now()})`);
      }
      await tx.update(smsMessages).set({ status: 'failed' }).where(eq(smsMessages.messageId, messageId));
      return send !== undefined;
    });
  }

  /** The worker delivered the message. */
  async markSent(tenantId: string, messageId: string): Promise<void> {
    await withTenant(this.db, tenantId, (tx) =>
      tx
        .update(smsMessages)
        .set({ status: 'sent' })
        .where(and(eq(smsMessages.messageId, messageId), inArray(smsMessages.status, ['pending', 'queued']))),
    );
  }

  /**
   * Messages debited but never queued (the API process died between commit and enqueue) cannot
   * be re-sent because no phone number or text is stored, so they are refunded.
   */
  async refundStalePending(tenantId: string, olderThanMs = 30 * 60_000): Promise<number> {
    const cutoff = new Date(this.clock.now().getTime() - olderThanMs);
    const stale = await withTenant(this.db, tenantId, (tx) =>
      tx
        .select({ messageId: smsMessages.messageId })
        .from(smsMessages)
        .where(and(eq(smsMessages.status, 'pending'), sql`${smsMessages.createdAt} < ${cutoff}`))
        .limit(500),
    );
    let refunded = 0;
    for (const { messageId } of stale) if (await this.refund(tenantId, messageId)) refunded += 1;
    if (refunded > 0) this.logger.warn({ tenantId, refunded }, 'Refunded SMS that were debited but never queued');
    return refunded;
  }
}
