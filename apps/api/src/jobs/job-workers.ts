import {
  Inject,
  Injectable,
  Logger,
  Optional,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { type Job, UnrecoverableError, Worker } from 'bullmq';
import { Redis } from 'ioredis';
import { ZodError } from 'zod';
import { APP_CONFIG, type AppConfig } from '../config/config';
import { ProcessorRegistry } from './processor-registry';
import { DEFAULT_JOB_OPTIONS, JOBS, JOBS_PREFIX, prepareJob, type QueueName } from './queues';

/** Test hook: a private key prefix so tests never touch real queues. */
export interface JobWorkerOptions {
  prefix?: string;
}
export const JOB_WORKER_OPTIONS = Symbol('JobWorkerOptions');

/** How long shutdown waits for running jobs before forcing the workers closed. */
const DRAIN_TIMEOUT_MS = 30_000;

/**
 * Turn the registered processors into BullMQ workers (worker process only), one per queue.
 *
 * - Payloads are validated again here; an invalid one is an `UnrecoverableError` (retrying a
 *   malformed job never helps), and it lands in the failed set.
 * - Exhausted jobs stay in BullMQ's `failed` set (dead letter, ADR 0012) and are logged at
 *   `error` with queue, job id and tenant id: never the payload, which can hold SMS text.
 * - On shutdown workers stop taking jobs, wait for running ones (up to 30 s), then close.
 */
@Injectable()
export class JobWorkers implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger('Jobs');
  private readonly workers: Worker[] = [];
  private connection: Redis | undefined;

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly registry: ProcessorRegistry,
    @Optional() @Inject(JOB_WORKER_OPTIONS) private readonly options: JobWorkerOptions = {},
  ) {}

  onApplicationBootstrap(): void {
    const queues = this.registry.queues();
    if (!queues.length) return;
    if (!this.config.valkeyUrl) {
      this.logger.warn('VALKEY_URL is not set: job processors are not started');
      return;
    }
    // Workers use blocking commands: unlimited retries, offline queue on (BullMQ requirement).
    this.connection = new Redis(this.config.valkeyUrl, { maxRetriesPerRequest: null });
    this.connection.on('error', (error: Error) => {
      this.logger.warn(`Valkey connection error: ${error.message}`);
    });
    for (const queue of queues) this.start(queue, this.connection);
    this.logger.log(`Job workers started: ${queues.join(', ')}`);
  }

  private start(queue: QueueName, connection: Redis): void {
    const processor = this.registry.get(queue);
    if (!processor) return;
    const worker = new Worker(
      queue,
      async (job: Job) => {
        let prepared;
        try {
          prepared = prepareJob(queue, job.data);
        } catch (error) {
          if (error instanceof ZodError) {
            throw new UnrecoverableError('Invalid job payload');
          }
          throw error;
        }
        await processor(prepared.payload as never, {
          queue,
          jobId: job.id ?? prepared.jobId,
          attempt: job.attemptsMade + 1,
        });
      },
      {
        connection,
        prefix: this.options.prefix ?? JOBS_PREFIX,
        concurrency: JOBS[queue].concurrency,
      },
    );
    worker.on('failed', (job, error) => {
      const attempts = job?.opts.attempts ?? DEFAULT_JOB_OPTIONS.attempts;
      const final = error instanceof UnrecoverableError || (job?.attemptsMade ?? 0) >= attempts;
      const fields = {
        queue,
        jobId: job?.id,
        tenantId: (job?.data as { tenantId?: string } | undefined)?.tenantId,
        attempt: job?.attemptsMade,
      };
      this.logger[final ? 'error' : 'warn'](
        { ...fields, err: error.message },
        final ? 'Job failed permanently (dead letter)' : 'Job failed, will retry',
      );
    });
    worker.on('error', (error) => {
      this.logger.warn(`Worker "${queue}" error: ${error.message}`);
    });
    this.workers.push(worker);
  }

  async onApplicationShutdown(): Promise<void> {
    if (!this.workers.length) return;
    const drain = Promise.all(this.workers.map((w) => w.close()));
    const timedOut = Symbol('timeout');
    let timer: NodeJS.Timeout | undefined;
    const result = await Promise.race([
      drain,
      new Promise<typeof timedOut>((resolve) => {
        timer = setTimeout(() => {
          resolve(timedOut);
        }, DRAIN_TIMEOUT_MS);
      }),
    ]);
    clearTimeout(timer);
    if (result === timedOut) {
      this.logger.warn('Jobs still running after 30 s: closing workers anyway');
      await Promise.all(this.workers.map((w) => w.close(true)));
    }
    this.workers.length = 0;
    await this.connection?.quit().catch(() => this.connection?.disconnect());
  }
}
