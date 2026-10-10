import { Global, Module } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { FeesController } from './fees.controller';
import { FeesHooks } from './fees-hooks';
import { FeesService } from './fees.service';
import { SecretBox } from '../../integrations/secret-box';
import { PAYMENT_PROVIDER } from '../../integrations/payment/payment.provider';
import { PayherePaymentProvider } from '../../integrations/payment/payhere.provider';
import { CheckoutsController, PayhereWebhookController } from './checkouts.controller';
import { CheckoutsService } from './checkouts.service';
import { PayhereSettingsService } from './payhere-settings.service';
import { MoneySettingsController } from './money-settings.controller';
import { FeeSettingsService } from './fee-settings.service';
import { ReceiptJobEnqueuer, ReceiptJobRunner } from './receipt-jobs';
import { ReceiptsService } from './receipts.service';

@Global()
@Module({
  controllers: [FeesController, MoneySettingsController, CheckoutsController, PayhereWebhookController],
  providers: [
    FeesService,
    FeesHooks,
    AuditService,
    SecretBox,
    // The real adapter: pure signing/verification, no network (FEE-04).
    { provide: PAYMENT_PROVIDER, useClass: PayherePaymentProvider },
    CheckoutsService,
    PayhereSettingsService,
    FeeSettingsService,
    ReceiptJobEnqueuer,
    ReceiptJobRunner,
    ReceiptsService,
  ],
  exports: [FeesService, FeesHooks, ReceiptJobRunner],
})
export class FeesModule {}
