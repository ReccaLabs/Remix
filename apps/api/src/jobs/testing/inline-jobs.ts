import { UnrecoverableError } from 'bullmq';
import {
  DEFAULT_JOB_OPTIONS,
  prepareJob,
  type JobPayload,
  type JobProcessor,
  type QueueName,
} from '../queues';
import type { AddedJob, JobProducer } from '../job-producer';

export interface InlineJobRecord<Q extends QueueName = QueueName> {
  queue: Q;
  jobId: string;
  payload: JobPayload<Q>;
  status: 'pending' | 'completed' | 'failed';
  /** Attempts made so far. */
  attempts: number;
  error?: Error;
}

type ProcessorMap = { [Q in QueueName]?: JobProcessor<Q> };

/**
 * Test double for `JOB_PRODUCER` that runs processors in-process, with no Valkey. It applies the
 * same rules as the real producer: payload validated against the queue schema, job id = business
 * key, duplicates ignored, retries (without delay) and `UnrecoverableError`.
 *
 * ```ts
 * const jobs = new InlineJobProducer({ sms: createSmsProcessor(smsMock) });
 * // Nest test: overrideProvider(JOB_PRODUCER).useValue(jobs)
 * await service.requestCode(...);
 * await jobs.drain();                      // run everything queued
 * expect(smsMock.callsTo('send')).toHaveLength(1);
 * ```
 *
 * By default jobs wait until `drain()` (mirrors "the worker runs later"); `{ autoRun: true }`
 * runs each one inside `add`.
 */
export class InlineJobProducer implements JobProducer {
  readonly jobs: InlineJobRecord[] = [];

  constructor(
    private readonly processors: ProcessorMap,
    private readonly options: { autoRun?: boolean } = {},
  ) {}

  async add<Q extends QueueName>(queue: Q, payload: JobPayload<Q>): Promise<AddedJob> {
    const prepared = prepareJob(queue, payload);
    if (!this.jobs.some((j) => j.jobId === prepared.jobId)) {
      this.jobs.push({
        queue,
        jobId: prepared.jobId,
        payload: prepared.payload,
        status: 'pending',
        attempts: 0,
      });
      if (this.options.autoRun) await this.drain();
    }
    return { jobId: prepared.jobId };
  }

  hasJob(queue: QueueName, jobId: string): Promise<boolean> {
    return Promise.resolve(this.jobs.some((j) => j.queue === queue && j.jobId === jobId));
  }

  /** Run every pending job to completion or final failure. Never throws: inspect `jobs`. */
  async drain(): Promise<void> {
    for (const job of this.jobs) {
      if (job.status !== 'pending') continue;
      const processor = this.processors[job.queue];
      if (!processor) throw new Error(`No processor registered for queue "${job.queue}"`);
      while (job.status === 'pending') {
        job.attempts += 1;
        try {
          await processor(job.payload as never, {
            queue: job.queue,
            jobId: job.jobId,
            attempt: job.attempts,
          });
          job.status = 'completed';
        } catch (error) {
          job.error = error as Error;
          if (error instanceof UnrecoverableError || job.attempts >= DEFAULT_JOB_OPTIONS.attempts) {
            job.status = 'failed';
          }
        }
      }
    }
  }

  /** Jobs of one queue, typed. */
  of<Q extends QueueName>(queue: Q): InlineJobRecord<Q>[] {
    return this.jobs.filter((j): j is InlineJobRecord<Q> => j.queue === queue);
  }
}
