import { Global, Module } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { FeesController } from './fees.controller';
import { FeesHooks } from './fees-hooks';
import { FeesService } from './fees.service';

@Global()
@Module({ controllers: [FeesController], providers: [FeesService, FeesHooks, AuditService], exports: [FeesService, FeesHooks] })
export class FeesModule {}
