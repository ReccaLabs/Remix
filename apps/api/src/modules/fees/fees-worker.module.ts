import { type DynamicModule, Inject, Injectable, Logger, Module, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import type { Db } from '@remix/db';
import { CLOCK, systemClock, type Clock } from '../../common/time/clock';
import { APP_CONFIG, type AppConfig } from '../../config/config';
import { HealthModule } from '../../health/health.module';
import { DEFAULT_JOB_OPTIONS, FEES_SYSTEM_TENANT, JOBS_PREFIX } from '../../jobs/queues';
import { JOB_PRODUCER, type JobProducer } from '../../jobs/job-producer';
import { JobsModule } from '../../jobs/jobs.module';
import { ProcessorRegistry } from '../../jobs/processor-registry';
import { DB } from '../db/db.module';
import { createFeesProcessor, FEES_SCHEDULES } from './fees-processor';

@Injectable()
class FeesJobs implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger('FeesJobs');
  private connection?: Redis;
  private queue?: Queue;
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig, registry: ProcessorRegistry,
    @Inject(DB) db: Db, @Inject(JOB_PRODUCER) jobs: JobProducer, @Inject(CLOCK) clock: Clock) {
    registry.register('fees', createFeesProcessor(db, jobs, clock,
      (tenantId, invoiceIds) => { this.logger.error({ tenantId, invoiceIds }, 'Fee projection drift repaired'); }));
  }
  async onApplicationBootstrap(): Promise<void> {
    if (!this.config.valkeyUrl) return;
    this.connection = new Redis(this.config.valkeyUrl, { maxRetriesPerRequest: null });
    this.connection.on('error', error => { this.logger.warn({ err: error.message }, 'Fees scheduler connection error'); });
    this.queue = new Queue('fees', { connection: this.connection, prefix: JOBS_PREFIX });
    this.queue.on('error', error => { this.logger.warn({ err: error.message }, 'Fees scheduler error'); });
    try {
      await this.queue.upsertJobScheduler('fees-monthly', FEES_SCHEDULES.monthly,
        { name: 'fees', data: { kind: 'monthly_tick', tenantId: FEES_SYSTEM_TENANT }, opts: DEFAULT_JOB_OPTIONS });
      await this.queue.upsertJobScheduler('fees-nightly', FEES_SCHEDULES.nightly,
        { name: 'fees', data: { kind: 'nightly_tick', tenantId: FEES_SYSTEM_TENANT }, opts: DEFAULT_JOB_OPTIONS });
    } catch (error) { await this.onApplicationShutdown(); throw error; }
  }
  async onApplicationShutdown(): Promise<void> {
    await this.queue?.close();
    await this.connection?.quit().catch(() => this.connection?.disconnect());
  }
}

/** Needs the global `DB` that ImportWorkerModule's DbModule.forRoot provides (one pool, one readiness check). */
@Module({})
export class FeesWorkerModule {
  static forRoot(config: AppConfig): DynamicModule {
    return { module: FeesWorkerModule, imports: [HealthModule, JobsModule.forRoot(config)],
      providers: [{ provide: APP_CONFIG, useValue: config }, { provide: CLOCK, useValue: systemClock }, FeesJobs] };
  }
}
