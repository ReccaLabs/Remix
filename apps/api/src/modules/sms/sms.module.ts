import { type DynamicModule, Global, Module } from '@nestjs/common';
import { CLOCK, systemClock } from '../../common/time/clock';
import { SMS_BILLING } from '../../jobs/sms/sms.processor';
import { AuditService } from '../audit/audit.service';
import { FeeRemindersService } from './fee-reminders.service';
import { ReceiptSmsNotifier } from './receipt-sms.notifier';
import { SmsBillingService } from './sms-billing.service';
import { SmsController } from './sms.controller';
import { SmsWalletService } from './sms-wallet.service';
import { SystemSmsService } from './system-sms.service';

const CORE = [
  AuditService,
  SmsWalletService,
  SystemSmsService,
  FeeRemindersService,
  SmsBillingService,
  { provide: SMS_BILLING, useExisting: SmsBillingService },
];

/**
 * MSG-02/04, FEE-02/12 in the API process: the wallet endpoints, manual reminders, the receipt
 * SMS hook and `SystemSmsService` (inject it from other modules, e.g. slips in 3-D). Global so
 * feature modules need not import it.
 */
@Global()
@Module({
  controllers: [SmsController],
  providers: [...CORE, ReceiptSmsNotifier],
  exports: [SystemSmsService, SmsWalletService, FeeRemindersService, SMS_BILLING],
})
export class SmsModule {}

/**
 * The same services in the worker process (no controllers, no receipt hook, which lives with the
 * API's payment flow): the `sms` processor reports sent/failed to the wallet, and the fees
 * worker sends the automatic reminders. Needs the global `DB` and `JOB_PRODUCER` of the worker.
 */
@Global()
@Module({})
export class SmsWorkerModule {
  static forRoot(): DynamicModule {
    return {
      module: SmsWorkerModule,
      providers: [{ provide: CLOCK, useValue: systemClock }, ...CORE],
      exports: [SystemSmsService, SmsWalletService, FeeRemindersService, SMS_BILLING],
    };
  }
}
