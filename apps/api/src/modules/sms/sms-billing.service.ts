import { Injectable } from '@nestjs/common';
import type { SmsBilling } from '../../jobs/sms/sms.processor';
import { SmsWalletService } from './sms-wallet.service';

/** The `sms` worker's view of the wallet: mark delivered, or refund a permanent failure. */
@Injectable()
export class SmsBillingService implements SmsBilling {
  constructor(private readonly wallet: SmsWalletService) {}

  onSent(tenantId: string, messageId: string): Promise<void> {
    return this.wallet.markSent(tenantId, messageId);
  }

  async onPermanentFailure(tenantId: string, messageId: string): Promise<void> {
    await this.wallet.refund(tenantId, messageId);
  }
}
