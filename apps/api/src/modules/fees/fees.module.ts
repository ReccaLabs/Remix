import { Global, Module } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { FeesController } from './fees.controller';
import { FeesHooks } from './fees-hooks';
import { FeesService } from './fees.service';
import { SecretBox } from '../../integrations/secret-box';
import { PayhereCheckoutBuilder } from '../../integrations/payment/payhere-checkout-builder';
import { PayhereSettingsService } from './payhere-settings.service';
import { MoneySettingsController } from './money-settings.controller';
import { FeeSettingsService } from './fee-settings.service';
import { ReceiptJobEnqueuer, ReceiptJobRunner } from './receipt-jobs';
import { ReceiptsService } from './receipts.service';

@Global()
@Module({
  controllers: [FeesController, MoneySettingsController],
  providers: [
    FeesService,
    FeesHooks,
    AuditService,
    SecretBox,
    PayhereCheckoutBuilder,
    PayhereSettingsService,
    FeeSettingsService,
    ReceiptJobEnqueuer,
    ReceiptJobRunner,
    ReceiptsService,
  ],
  exports: [FeesService, FeesHooks, ReceiptJobRunner],
})
export class FeesModule {}
