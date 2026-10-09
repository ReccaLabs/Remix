import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { schema, withTenant, type Db } from '@remix/db';
import { DB } from '../db/db.module';
import { FeesHooks, type PaymentCommittedEvent } from '../fees/fees-hooks';
import { FEE_SMS_RECIPIENT_SQL } from './fee-reminders.service';
import { InsufficientSmsBalanceError, SystemSmsService } from './system-sms.service';

interface ReceiptSmsRow extends Record<string, unknown> {
  amount_cents: string;
  receipt_number: string;
  student_name: string;
  phone: string | null;
  enabled: boolean | null;
}

/**
 * MSG-04: after a payment commits (cash, manual, and later card and slip, which all go through
 * `FeesService.recordPayment`), text the receipt to the guardian or student when the institute
 * switched receipt SMS on. This must never disturb the cashier: a missing mobile, an empty
 * wallet or a queue outage is logged and skipped (FeesHooks also swallows anything thrown).
 */
@Injectable()
export class ReceiptSmsNotifier implements OnModuleInit {
  private readonly logger = new Logger('ReceiptSms');

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly hooks: FeesHooks,
    private readonly sms: SystemSmsService,
  ) {}

  onModuleInit(): void {
    this.hooks.registerPaymentCommitted((event) => this.onPayment(event));
  }

  async onPayment(event: PaymentCommittedEvent): Promise<void> {
    const row = await withTenant(this.db, event.tenantId, async (tx) => {
      const [settings] = await tx
        .select({ enabled: schema.tenantSettings.receiptSmsEnabled })
        .from(schema.tenantSettings);
      if (!settings?.enabled) return null;
      const rows = await tx.execute<ReceiptSmsRow>(sql`
        select p.amount_cents::text as amount_cents, r.number as receipt_number, u.display_name as student_name,
          ${FEE_SMS_RECIPIENT_SQL} as phone, true as enabled
        from public.receipts r
        join public.payments p on p.tenant_id = r.tenant_id and p.id = r.payment_id
        join public.students s on s.tenant_id = p.tenant_id and s.user_id = p.student_id
        join public.tenant_users u on u.tenant_id = s.tenant_id and u.id = s.user_id
        where r.id = ${event.receiptId}`);
      return rows.rows[0] ?? null;
    });
    if (!row) return;
    if (!row.phone) {
      this.logger.log({ tenantId: event.tenantId, paymentId: event.paymentId }, 'Receipt SMS skipped: no mobile number');
      return;
    }
    try {
      await this.sms.send(
        event.tenantId,
        'receipt_issued',
        { student: row.student_name, amountCents: Number(row.amount_cents), receiptNo: row.receipt_number },
        row.phone,
        `receipt-${event.paymentId}`,
      );
    } catch (error) {
      if (error instanceof InsufficientSmsBalanceError) {
        this.logger.warn({ tenantId: event.tenantId, paymentId: event.paymentId }, 'Receipt SMS skipped: SMS wallet is empty');
        return;
      }
      throw error;
    }
  }
}
