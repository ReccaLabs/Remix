import {
  type DynamicModule,
  type INestApplicationContext,
  Injectable,
  Logger,
  Module,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { LoggerModule, Logger as PinoNestLogger } from 'nestjs-pino';
import type { DestinationStream } from 'pino';
import { loggerParams } from './common/logging/logger';
import { APP_CONFIG, type AppConfig } from './config/config';
import { WorkerJobsModule } from './jobs/jobs.module';
import { ImportWorkerModule } from './modules/imports/import-worker.module';
import { FeesWorkerModule } from './modules/fees/fees-worker.module';

/**
 * Keeps the worker process alive until shutdown. BullMQ workers (ADR 0012) hold their own
 * Valkey connections open; without VALKEY_URL (dev/tests) this timer is the only handle, and it doubles as a
 * debug heartbeat.
 */
@Injectable()
export class WorkerLifecycle implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger('Worker');
  private timer: NodeJS.Timeout | undefined;

  onApplicationBootstrap(): void {
    this.timer = setInterval(() => {
      this.logger.debug('heartbeat');
    }, 60_000);
    this.logger.log('Worker started');
  }

  onApplicationShutdown(signal?: string): void {
    clearInterval(this.timer);
    this.logger.log(`Worker stopped${signal ? ` (${signal})` : ''}`);
  }
}

export interface WorkerOptions {
  config: AppConfig;
  logDestination?: DestinationStream;
}

/** Root module of the worker process: same codebase, no HTTP server. Queue processors go here. */
@Module({})
export class WorkerModule {
  static forRoot(options: WorkerOptions): DynamicModule {
    return {
      module: WorkerModule,
      imports: [
        LoggerModule.forRoot(loggerParams(options.config, options.logDestination)),
        WorkerJobsModule.forRoot(options.config),
        // Processors that touch tenant data need the database (not configured in bare tests).
        ...(options.config.databaseUrl ? [ImportWorkerModule.forRoot(options.config), FeesWorkerModule.forRoot(options.config)] : []),
      ],
      providers: [{ provide: APP_CONFIG, useValue: options.config }, WorkerLifecycle],
    };
  }
}

/**
 * Create and start the worker context (shared by `worker.ts` and tests). SIGTERM/SIGINT run the
 * `onApplicationShutdown` hooks — drain jobs, close connections — before the process exits.
 */
export async function createWorker(options: WorkerOptions): Promise<INestApplicationContext> {
  const app = await NestFactory.createApplicationContext(WorkerModule.forRoot(options), {
    bufferLogs: true,
  });
  app.useLogger(app.get(PinoNestLogger));
  app.flushLogs();
  app.enableShutdownHooks();
  await app.init();
  return app;
}
