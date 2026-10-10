import { Inject, Injectable, Logger } from '@nestjs/common';
import { schema, withTenant, type Db } from '@remix/db';
import { JOB_PRODUCER, type JobProducer } from '../../jobs/job-producer';
import { PLATFORM_SENDER_ID, maskPhone } from '../../integrations/sms/sms-http';
import { DB } from '../db/db.module';
import { renderSmsTemplate, type SmsTemplate, type SmsTemplateVars } from './sms-templates';
import { SmsWalletService, type MessageToCharge } from './sms-wallet.service';

export { InsufficientSmsBalanceError } from './sms-wallet.service';

/** A normalised Sri Lankan mobile, the only recipient the `sms` queue accepts. */
export const SMS_RECIPIENT = /^\+947\d{8}$/;
const MESSAGE_ID = /^[A-Za-z0-9_-]{1,100}$/;

/** What callers supply: the institute name is added by the service from the tenant row. */
export type SystemSmsVars<T extends SmsTemplate> = Omit<SmsTemplateVars[T], 'institute'>;

export interface SystemSmsItem<T extends SmsTemplate = SmsTemplate> {
  template: T;
  vars: SystemSmsVars<T>;
  /** E.164 Sri Lankan mobile. */
  to: string;
  /**
   * The business key of this message (also the job id and the provider idempotency key):
   * `receipt-<paymentId>`, `rem-before-<invoiceId>`, `slip-rejected-<slipId>`, …
   * Sending the same key again charges and sends nothing.
   */
  idempotencyKey: string;
}

export interface SystemSmsResult {
  messageId: string;
  /** `replayed`: this key was already charged; nothing new was queued. */
  status: 'queued' | 'replayed';
  costCents: number;
  segments: number;
}

export class InvalidSmsRequestError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = 'InvalidSmsRequestError';
  }
}

/**
 * MSG-04 entry point for every wallet-billed system SMS (receipts, slip decisions, fee
 * reminders; OTP and invite SMS are platform cost and keep using `AuthSmsService`).
 *
 * Order matters and is the whole safety story:
 * 1. one transaction: record the message id (idempotency key), lock the wallet, check the
 *    balance, append the `send` debit; any failure rolls everything back;
 * 2. after commit, enqueue the job (`billed: true`);
 * 3. if the queue is down, refund immediately and surface the error; if the worker later gives
 *    up on the message, it refunds from there (`SmsBillingService`).
 */
@Injectable()
export class SystemSmsService {
  private readonly logger = new Logger('SystemSms');

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(JOB_PRODUCER) private readonly jobs: JobProducer,
    private readonly wallet: SmsWalletService,
  ) {}

  /** `send(tenantId, template, vars, to, idempotencyKey)`: one message, debited then queued. */
  async send<T extends SmsTemplate>(
    tenantId: string,
    template: T,
    vars: SystemSmsVars<T>,
    to: string,
    idempotencyKey: string,
  ): Promise<SystemSmsResult> {
    const [result] = await this.sendAll(tenantId, [{ template, vars, to, idempotencyKey }]);
    if (!result) throw new Error('sendAll returned no result');
    return result;
  }

  /**
   * Several messages with an all-or-nothing balance check ({@link InsufficientSmsBalanceError}
   * and nothing queued when the wallet cannot cover the new ones).
   */
  async sendAll(tenantId: string, items: readonly SystemSmsItem[]): Promise<SystemSmsResult[]> {
    if (items.length === 0) return [];
    for (const item of items) {
      if (!SMS_RECIPIENT.test(item.to)) throw new InvalidSmsRequestError('Recipient is not a Sri Lankan mobile');
      if (!MESSAGE_ID.test(item.idempotencyKey)) throw new InvalidSmsRequestError('Bad idempotency key');
    }
    const prepared = await withTenant(this.db, tenantId, async (tx) => {
      const [tenant] = await tx
        .select({ name: schema.tenants.name, locale: schema.tenants.defaultLocale })
        .from(schema.tenants);
      if (!tenant) throw new InvalidSmsRequestError('Unknown tenant');
      const rendered = items.map((item) => ({
        item,
        ...renderSmsTemplate(item.template, { ...item.vars, institute: tenant.name } as never, tenant.locale),
      }));
      const messages: MessageToCharge[] = rendered.map((r) => ({
        messageId: r.item.idempotencyKey,
        template: r.item.template,
        segments: r.segments,
      }));
      const charges = await this.wallet.chargeAll(tx, tenantId, messages);
      if (charges.some((c) => c.created)) await this.wallet.noteLowBalance(tx, tenantId);
      return { rendered, charges, senderId: await this.wallet.senderId(tx) };
    });

    const results: SystemSmsResult[] = [];
    const queued: string[] = [];
    for (const [i, entry] of prepared.rendered.entries()) {
      const charge = prepared.charges[i];
      if (!charge) throw new Error('Charge missing');
      const base = {
        messageId: charge.messageId,
        costCents: charge.costCents,
        segments: entry.segments,
      };
      if (!charge.created) {
        results.push({ ...base, status: 'replayed' });
        continue;
      }
      try {
        await this.jobs.add('sms', {
          tenantId,
          messageId: charge.messageId,
          gateway: 'remix-wallet',
          senderId: prepared.senderId ?? PLATFORM_SENDER_ID,
          to: entry.item.to,
          text: entry.text,
          billed: true,
        });
      } catch (error) {
        // Queue down: nobody will send these, so give the money back (all not yet queued).
        const pending = prepared.charges.slice(i).filter((c) => c.created);
        for (const c of pending) await this.wallet.refund(tenantId, c.messageId);
        if (queued.length > 0) await this.wallet.markQueued(tenantId, queued);
        this.logger.error(
          { tenantId, recipient: maskPhone(entry.item.to), refunded: pending.length },
          'SMS queue unavailable; debit refunded',
        );
        throw error;
      }
      queued.push(charge.messageId);
      results.push({ ...base, status: 'queued' });
    }
    await this.wallet.markQueued(tenantId, queued);
    return results;
  }
}
