import {
  type DynamicModule,
  Inject,
  Injectable,
  Logger,
  Module,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { CLOCK, systemClock } from '../../common/time/clock';
import { APP_CONFIG, type AppConfig } from '../../config/config';
import { HealthModule } from '../../health/health.module';
import { StorageModule } from '../../integrations/storage/storage.module';
import { JOB_PRODUCER, type JobProducer } from '../../jobs/job-producer';
import { JobsModule } from '../../jobs/jobs.module';
import { ProcessorRegistry } from '../../jobs/processor-registry';
import { DEFAULT_JOB_OPTIONS, FEES_SYSTEM_TENANT, JOBS_PREFIX } from '../../jobs/queues';
import { MEDIA_SCHEDULES, MediaJobRunner } from './media-jobs';

/** Registers the `media` processor and the hourly stale-upload clean-up (ADR 0009, 0012). */
@Injectable()
class MediaJobs implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger('MediaJobs');
  private connection?: Redis;
  private queue?: Queue;
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    registry: ProcessorRegistry,
    runner: MediaJobRunner,
    @Inject(JOB_PRODUCER) jobs: JobProducer,
  ) {
    registry.register('media', (payload) => runner.run(payload, jobs));
  }
  async onApplicationBootstrap(): Promise<void> {
    if (!this.config.valkeyUrl) return;
    this.connection = new Redis(this.config.valkeyUrl, { maxRetriesPerRequest: null });
    this.connection.on('error', (error) => {
      this.logger.warn({ err: error.message }, 'Media scheduler connection error');
    });
    this.queue = new Queue('media', { connection: this.connection, prefix: JOBS_PREFIX });
    this.queue.on('error', (error) => {
      this.logger.warn({ err: error.message }, 'Media scheduler error');
    });
    try {
      await this.queue.upsertJobScheduler('media-cleanup', MEDIA_SCHEDULES.cleanup, {
        name: 'media',
        data: { kind: 'cleanup_tick', tenantId: FEES_SYSTEM_TENANT },
        opts: DEFAULT_JOB_OPTIONS,
      });
    } catch (error) {
      await this.onApplicationShutdown();
      throw error;
    }
  }
  async onApplicationShutdown(): Promise<void> {
    await this.queue?.close();
    await this.connection?.quit().catch(() => this.connection?.disconnect());
  }
}

/** Needs the global `DB` that ImportWorkerModule's DbModule.forRoot provides. */
@Module({})
export class MediaWorkerModule {
  static forRoot(config: AppConfig): DynamicModule {
    return {
      module: MediaWorkerModule,
      imports: [HealthModule, StorageModule.forRoot(config), JobsModule.forRoot(config)],
      providers: [
        { provide: APP_CONFIG, useValue: config },
        { provide: CLOCK, useValue: systemClock },
        MediaJobRunner,
        MediaJobs,
      ],
    };
  }
}
