import { type DynamicModule, Injectable, Module } from '@nestjs/common';
import type { AppConfig } from '../../config/config';
import { StorageModule } from '../../integrations/storage/storage.module';
import { ProcessorRegistry } from '../../jobs/processor-registry';
import { ReceiptJobRunner } from './receipt-jobs';

@Injectable()
class ReceiptJobRegistration {
  constructor(registry: ProcessorRegistry, runner: ReceiptJobRunner) {
    registry.register('receipts', (payload) => runner.run(payload));
  }
}
@Module({})
export class ReceiptsWorkerModule {
  static forRoot(config: AppConfig): DynamicModule {
    return {
      module: ReceiptsWorkerModule,
      imports: [StorageModule.forRoot(config)],
      providers: [ReceiptJobRunner, ReceiptJobRegistration],
    };
  }
}
