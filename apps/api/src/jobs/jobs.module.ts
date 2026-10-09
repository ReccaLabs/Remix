import { type DynamicModule, Global, Inject, Injectable, Module, Optional } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { VALKEY } from '../common/valkey/valkey';
import { SMS_PROVIDER, type SmsProvider } from '../integrations/sms/sms.provider';
import { smsProviderBinding } from '../integrations/sms/sms-binding';
import { APP_CONFIG, type AppConfig } from '../config/config';
import { BullJobProducer, JOB_PRODUCER, UnavailableJobProducer } from './job-producer';
import { JobWorkers } from './job-workers';
import { ProcessorRegistry } from './processor-registry';
import { ImportRunner } from '../modules/imports/import-runner';
import { ReceiptJobRunner } from '../modules/fees/receipt-jobs';
import { createSmsProcessor, SMS_BILLING, type SmsBilling } from './sms/sms.processor';
import { InlineJobProducer } from './testing/inline-jobs';

/**
 * Producer side, imported by the API (`AppModule`): exposes `JOB_PRODUCER` globally so feature
 * modules can `add` jobs. Without `VALKEY_URL`:
 * - development (`pnpm dev`, E2E): jobs run inline in the API process — SMS through the logging
 *   mock provider, so sign-in codes appear in the API log (ADR 0004 addendum "Development");
 * - tests: the producer rejects every add; tests bind their own `InlineJobProducer`.
 * Production always has `VALKEY_URL` (enforced by the config) and never gets either.
 */
@Global()
@Module({})
export class JobsModule {
  static forRoot(config: AppConfig): DynamicModule {
    return {
      module: JobsModule,
      providers: [
        config.valkeyUrl
          ? {
              provide: JOB_PRODUCER,
              useFactory: (client: Redis) => new BullJobProducer(client),
              inject: [VALKEY],
            }
          : config.nodeEnv === 'development'
            ? {
                provide: JOB_PRODUCER,
                useFactory: (imports?: ImportRunner, receipts?: ReceiptJobRunner, billing?: SmsBilling) =>
                  new InlineJobProducer(
                    {
                      sms: createSmsProcessor(smsProviderBinding(config), billing),
                      ...(imports
                        ? {
                            imports: async (payload, ctx) => {
                              await imports.run(payload, ctx);
                            },
                          }
                        : {}),
                      ...(receipts ? { receipts: (payload) => receipts.run(payload) } : {}),
                    },
                    { autoRun: true },
                  ),
                inject: [
                  { token: ImportRunner, optional: true },
                  { token: ReceiptJobRunner, optional: true },
                  { token: SMS_BILLING, optional: true },
                ],
              }
            : { provide: JOB_PRODUCER, useClass: UnavailableJobProducer },
      ],
      exports: [JOB_PRODUCER],
    };
  }
}

/** Registers the `sms` processor in the registry. */
@Injectable()
class SmsJobRegistration {
  constructor(
    registry: ProcessorRegistry,
    @Inject(SMS_PROVIDER) provider: SmsProvider,
    @Optional() @Inject(SMS_BILLING) billing?: SmsBilling,
  ) {
    registry.register('sms', createSmsProcessor(provider, billing));
  }
}

/**
 * Consumer side, imported by the worker (`WorkerModule`): the processor registry, the BullMQ
 * workers, the SMS provider (logging mock outside production) and the `sms` processor. Feature
 * modules add their own processors by injecting `ProcessorRegistry`.
 */
@Global()
@Module({})
export class WorkerJobsModule {
  static forRoot(config: AppConfig): DynamicModule {
    return {
      module: WorkerJobsModule,
      providers: [
        { provide: APP_CONFIG, useValue: config },
        { provide: SMS_PROVIDER, useFactory: () => smsProviderBinding(config) },
        ProcessorRegistry,
        SmsJobRegistration,
        JobWorkers,
      ],
      exports: [ProcessorRegistry, SMS_PROVIDER],
    };
  }
}
