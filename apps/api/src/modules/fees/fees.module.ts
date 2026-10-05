import { Global, Module } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { FeesController } from './fees.controller';
import { FeesHooks } from './fees-hooks';
import { FeesService } from './fees.service';
import { SecretBox } from '../../integrations/secret-box';
import { PayhereCheckoutBuilder } from '../../integrations/payment/payhere-checkout-builder';
import { PayhereSettingsService } from './payhere-settings.service';
import { MoneySettingsController } from './money-settings.controller';

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
  ],
  exports: [FeesService, FeesHooks],
})
export class FeesModule {}
