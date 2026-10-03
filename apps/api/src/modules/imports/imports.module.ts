import { Global, Module } from '@nestjs/common';
import { ImportRunner } from './import-runner';
import { ImportsController } from './imports.controller';
import { ImportsService } from './imports.service';

/**
 * Student import (STU-04 / DAT-01). Global only for {@link ImportRunner}, which the jobs module
 * hands to the inline producer in development (no Valkey); in production the worker process runs
 * it (`ImportWorkerModule`).
 */
@Global()
@Module({
  controllers: [ImportsController],
  providers: [ImportsService, ImportRunner],
  exports: [ImportRunner],
})
export class ImportsModule {}
