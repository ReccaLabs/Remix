import 'reflect-metadata';
import { exitOnStartupFailure } from './common/startup';
import { loadConfig } from './config/config';
import { createWorker } from './worker.module';

/** Worker entry: a Nest application context (no HTTP server) for queue processors and crons. */
createWorker({ config: loadConfig() }).catch(exitOnStartupFailure('Worker'));
