import { Inject, Injectable, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { withTenant, type Db } from '@remix/db';
import { DB } from '../db/db.module';
import { FEE_SMS_RECIPIENT_SQL } from '../sms/fee-reminders.service';
import { InsufficientSmsBalanceError, SystemSmsService } from '../sms/system-sms.service';

export interface SlipSmsTarget extends Record<string, unknown> {
  /** Guardian who opted in to SMS, else the student's own mobile; null when neither. */
  phone: string | null;
  /** `Oct 2026, Nov 2026` */
  months: string;
  /** Receipt of the slip's payment, once approved. */
  receipt_no: string | null;
}

/**
 * MSG-04, FEE-06: the "slip approved" / "slip rejected (reason)" SMS (ADR 0008 section 5). Called
 * after the review transaction commits, and it never throws: a missing mobile, an empty wallet
 * or a queue outage is logged and skipped (the number is never logged) so the cashier's decision
 * always stands. Idempotent per slip: the message id is the idempotency key, so a replay charges
 * nothing.
 */
@Injectable()
export class SlipSmsNotifier {
  private readonly logger = new Logger('SlipSms');

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly sms: SystemSmsService,
  ) {}

  approved(tenantId: string, slipId: string): Promise<void> {
    return this.notify(tenantId, slipId, 'approved');
  }

  rejected(tenantId: string, slipId: string, reason: string): Promise<void> {
    return this.notify(tenantId, slipId, 'rejected', reason);
  }

  /** The recipient and the wording inputs of one slip. */
  async target(tenantId: string, slipId: string): Promise<SlipSmsTarget | null> {
    return withTenant(this.db, tenantId, async (tx) => {
      const rows = await tx.execute<SlipSmsTarget>(sql`
        select ${FEE_SMS_RECIPIENT_SQL} as phone,
          coalesce((select string_agg(to_char(m.month, 'Mon YYYY'), ', ' order by m.month)
            from (select distinct il.month from public.bank_slip_lines bl
              join public.invoice_lines il on il.tenant_id = bl.tenant_id and il.id = bl.invoice_line_id
              where bl.slip_id = b.id) m), '') as months,
          (select r.number from public.receipts r where r.payment_id = b.payment_id limit 1) as receipt_no
        from public.bank_slips b
        join public.students s on s.tenant_id = b.tenant_id and s.user_id = b.student_id
        join public.tenant_users u on u.tenant_id = s.tenant_id and u.id = s.user_id
        where b.id = ${slipId}`);
      return rows.rows[0] ?? null;
    });
  }

  private async notify(tenantId: string, slipId: string, kind: 'approved' | 'rejected', reason = ''): Promise<void> {
    try {
      const target = await this.target(tenantId, slipId);
      if (!target) return;
      if (!target.phone) {
        this.logger.log({ tenantId, slipId, kind }, 'Slip SMS skipped: no mobile number');
        return;
      }
      const key = `slip-${kind}-${slipId}`;
      if (kind === 'approved') {
        await this.sms.send(
          tenantId,
          'slip_approved',
          { months: target.months || 'your fees', receiptNo: target.receipt_no ?? '' },
          target.phone,
          key,
        );
      } else {
        await this.sms.send(tenantId, 'slip_rejected', { reason }, target.phone, key);
      }
    } catch (error) {
      if (error instanceof InsufficientSmsBalanceError) {
        this.logger.warn({ tenantId, slipId, kind }, 'Slip SMS skipped: SMS wallet is empty');
        return;
      }
      this.logger.error(
        { tenantId, slipId, kind, error: error instanceof Error ? error.message : String(error) },
        'Slip SMS not sent',
      );
    }
  }
}
