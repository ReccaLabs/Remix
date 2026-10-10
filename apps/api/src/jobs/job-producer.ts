import { Injectable, type OnApplicationShutdown } from '@nestjs/common';
import { Queue } from 'bullmq';
import type { z } from 'zod';
import type { Redis } from 'ioredis';
import {
  DEFAULT_JOB_OPTIONS,
  JOBS,
  JOBS_PREFIX,
  prepareJob,
  type JobDefinition,
  type JobPayload,
  type QueueName,
} from './queues';

/** DI token for {@link JobProducer}. */
export const JOB_PRODUCER = Symbol('JobProducer');

/** Thrown by `add` when the queue backend is unreachable. Callers map it to a 503. */
export class JobQueueUnavailableError extends Error {
  constructor(cause?: unknown) {
    super('Job queue unavailable', { cause });
    this.name = 'JobQueueUnavailableError';
  }
}

export interface AddedJob {
  /** The business-key job id (`sms-<tenantId>-<messageId>`). */
  jobId: string;
}

/**
 * Enqueue side of the jobs API (inject with `@Inject(JOB_PRODUCER)`):
 *
 * ```ts
 * await jobs.add('sms', { tenantId, messageId, gateway, senderId, to, text });
 * ```
 *
 * The payload is validated against the queue's schema and the job id is derived from it (the
 * business key), so adding the same job twice is harmless. Rejects with `ZodError` for a bad
 * payload and {@link JobQueueUnavailableError} when Valkey is down; it never queues in memory.
 */
export interface JobProducer {
  add<Q extends QueueName>(queue: Q, payload: JobPayload<Q>): Promise<AddedJob>;
  /** Whether a job with this id is (still) in the queue: waiting, delayed, active, or kept after finishing. */
  hasJob(queue: QueueName, jobId: string): Promise<boolean>;
}

/** BullMQ producer over the shared fail-fast Valkey client. */
@Injectable()
export class BullJobProducer implements JobProducer, OnApplicationShutdown {
  private readonly queues = new Map<QueueName, Queue>();

  constructor(
    private readonly connection: Redis,
    private readonly prefix = JOBS_PREFIX,
  ) {}

  async add<Q extends QueueName>(queue: Q, payload: JobPayload<Q>): Promise<AddedJob> {
    const prepared = prepareJob(queue, payload);
    const def = JOBS[queue] as JobDefinition<z.ZodType>;
    try {
      await this.queueFor(queue).add(queue, prepared.payload, {
        ...DEFAULT_JOB_OPTIONS,
        jobId: prepared.jobId,
        removeOnComplete: def.removeOnComplete,
        removeOnFail: def.removeOnFail,
      });
    } catch (error) {
      throw new JobQueueUnavailableError(error);
    }
    return { jobId: prepared.jobId };
  }

  async hasJob(queue: QueueName, jobId: string): Promise<boolean> {
    try {
      return (await this.queueFor(queue).getJob(jobId)) !== undefined;
    } catch (error) {
      throw new JobQueueUnavailableError(error);
    }
  }

  private queueFor(name: QueueName): Queue {
    let queue = this.queues.get(name);
    if (!queue) {
      queue = new Queue(name, { connection: this.connection, prefix: this.prefix });
      // BullMQ emits `error` for connection problems; they surface as `add` rejections.
      queue.on('error', () => undefined);
      this.queues.set(name, queue);
    }
    return queue;
  }

  async onApplicationShutdown(): Promise<void> {
    await Promise.all([...this.queues.values()].map((queue) => queue.close()));
  }
}

/** Bound when no `VALKEY_URL` is configured (development/tests): every add fails loudly. */
export class UnavailableJobProducer implements JobProducer {
  add(): Promise<AddedJob> {
    return Promise.reject(new JobQueueUnavailableError(new Error('VALKEY_URL is not configured')));
  }

  hasJob(): Promise<boolean> {
    return Promise.reject(new JobQueueUnavailableError(new Error('VALKEY_URL is not configured')));
  }
}
