import { type DynamicModule, Inject, Injectable, Module } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { InMemoryRateLimiter, RATE_LIMITER } from '../../common/rate-limit/rate-limiter';
import { ValkeyRateLimiter } from '../../common/rate-limit/valkey-rate-limiter';
import { VALKEY, ValkeyModule } from '../../common/valkey/valkey';
import { CLOCK, systemClock } from '../../common/time/clock';
import { APP_CONFIG, type AppConfig } from '../../config/config';
import { HealthModule } from '../../health/health.module';
import { BullJobProducer, JOB_PRODUCER, UnavailableJobProducer } from '../../jobs/job-producer';
import { ProcessorRegistry } from '../../jobs/processor-registry';
import { AuditService } from '../audit/audit.service';
import { AuthSmsService } from '../auth/auth-sms.service';
import { CodeSendLimits } from '../auth/code-send-limits';
import { OtpService } from '../auth/otp.service';
import { PasswordService } from '../auth/passwords';
import { DbModule } from '../db/db.module';
import { PeopleHooks } from '../people/people-hooks';
import { ImportRunner } from './import-runner';

/**
 * Registers the `imports` processor in the worker and connects the welcome SMS (AUTH-07) to the
 * same OTP service the API uses, so a student imported with `sendWelcomeSms` gets exactly the
 * first-password code "Add student" sends (rate limits and the `sms` queue included).
 */
@Injectable()
class ImportJobRegistration {
  constructor(
    registry: ProcessorRegistry,
    runner: ImportRunner,
    hooks: PeopleHooks,
    @Inject(OtpService) otp: OtpService,
  ) {
    registry.register('imports', async (payload, ctx) => {
      await runner.run(payload, ctx);
    });
    hooks.registerStudentInvited(async (event) => {
      await otp.sendCodeToUser(event.tenantId, event.studentId, 'first_password');
    });
  }
}

/**
 * Worker-side wiring of the import job (ADR 0012): the database pool as `remix_app`, the Valkey
 * limiter and `sms` producer the welcome code needs, and the runner. Imported by `WorkerModule`
 * only when `DATABASE_URL` is set.
 */
@Module({})
export class ImportWorkerModule {
  static forRoot(config: AppConfig): DynamicModule {
    return {
      module: ImportWorkerModule,
      imports: [
        HealthModule,
        DbModule.forRoot(config),
        ...(config.valkeyUrl ? [ValkeyModule.forRoot(config)] : []),
      ],
      providers: [
        { provide: APP_CONFIG, useValue: config },
        { provide: CLOCK, useValue: systemClock },
        config.valkeyUrl
          ? {
              provide: RATE_LIMITER,
              useFactory: (client: Redis) => new ValkeyRateLimiter(client),
              inject: [VALKEY],
            }
          : { provide: RATE_LIMITER, useFactory: () => new InMemoryRateLimiter() },
        config.valkeyUrl
          ? {
              provide: JOB_PRODUCER,
              useFactory: (client: Redis) => new BullJobProducer(client),
              inject: [VALKEY],
            }
          : { provide: JOB_PRODUCER, useClass: UnavailableJobProducer },
        PasswordService,
        AuditService,
        AuthSmsService,
        CodeSendLimits,
        OtpService,
        PeopleHooks,
        ImportRunner,
        ImportJobRegistration,
      ],
    };
  }
}
