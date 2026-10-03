import { type DynamicModule, Global, Inject, Injectable, Module } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { VALKEY } from '../common/valkey/valkey';
import { SMS_PROVIDER, type SmsProvider } from '../integrations/sms/sms.provider';
import { smsProviderBinding } from '../integrations/sms/sms-binding';
import { APP_CONFIG, type AppConfig } from '../config/config';
import { BullJobProducer, JOB_PRODUCER, UnavailableJobProducer } from './job-producer';
import { JobWorkers } from './job-workers';
import { ProcessorRegistry } from './processor-registry';
import { createSmsProcessor } from './sms/sms.processor';

/**
 * Producer side, imported by the API (`AppModule`): exposes `JOB_PRODUCER` globally so feature
 * modules can `add` jobs. Without `VALKEY_URL` (development/tests) the producer rejects every
 * add; tests bind an `InlineJobProducer` instead.
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
          : { provide: JOB_PRODUCER, useClass: UnavailableJobProducer },
      ],
      exports: [JOB_PRODUCER],
    };
  }
}

/** Registers the `sms` processor in the registry. */
@Injectable()
class SmsJobRegistration {
  constructor(registry: ProcessorRegistry, @Inject(SMS_PROVIDER) provider: SmsProvider) {
    registry.register('sms', createSmsProcessor(provider));
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
