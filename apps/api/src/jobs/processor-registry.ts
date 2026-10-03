import { Injectable } from '@nestjs/common';
import type { JobProcessor, QueueName } from './queues';

/**
 * Where feature modules register their queue processors (worker process only). A module
 * injects the registry in its constructor and calls `register`; the worker starts consuming
 * once every module has initialised.
 *
 * ```ts
 * @Injectable()
 * class ImportJobs {
 *   constructor(registry: ProcessorRegistry, imports: ImportService) {
 *     registry.register('imports', (payload) => imports.run(payload));
 *   }
 * }
 * ```
 */
@Injectable()
export class ProcessorRegistry {
  private readonly processors = new Map<QueueName, JobProcessor<never>>();

  register<Q extends QueueName>(queue: Q, processor: JobProcessor<Q>): void {
    if (this.processors.has(queue)) {
      throw new Error(`A processor for queue "${queue}" is already registered`);
    }
    this.processors.set(queue, processor);
  }

  get(queue: QueueName): JobProcessor<never> | undefined {
    return this.processors.get(queue);
  }

  queues(): QueueName[] {
    return [...this.processors.keys()];
  }
}
