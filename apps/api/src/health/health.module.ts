import { Global, Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { ReadinessRegistry } from './readiness';

/** `/health` + `/health/ready`. Global so any module can register a readiness check. */
@Global()
@Module({
  controllers: [HealthController],
  providers: [ReadinessRegistry],
  exports: [ReadinessRegistry],
})
export class HealthModule {}
