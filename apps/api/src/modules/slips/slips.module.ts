import { Global, Module } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { MediaJobRunner } from './media-jobs';
import { SlipSmsNotifier } from './slip-sms.notifier';
import { SlipsController } from './slips.controller';
import { SlipsService } from './slips.service';

/**
 * FEE-05/06 HTTP side. `MediaJobRunner` is provided here only so the development inline job
 * producer can process uploads in-process without Valkey; production runs it in the worker.
 * Storage, jobs and the fee hooks come from the global Storage/Jobs/Fees modules. Global so the
 * (global) JobsModule can resolve the runner, as it does FeesModule's receipt runner.
 */
@Global()
@Module({
  controllers: [SlipsController],
  providers: [SlipsService, SlipSmsNotifier, AuditService, MediaJobRunner],
  exports: [SlipsService, MediaJobRunner],
})
export class SlipsModule {}
