import { Controller, Get, Header, HttpStatus, Res } from '@nestjs/common';
import type { Response } from 'express';
import { Public } from '../common/auth/auth.decorators';
import { HostScope } from '../common/tenant/tenant.guard';
import { ReadinessRegistry, type ReadinessReport } from './readiness';

/**
 * Probes for the deploy tooling and the proxy. Served on any host, outside `/api/v1`, with no
 * session, tenant or version info — nothing an attacker could use.
 */
@Controller('health')
@Public()
@HostScope('any')
export class HealthController {
  constructor(private readonly readiness: ReadinessRegistry) {}

  /** Liveness: the process is up and the event loop answers. No dependencies are touched. */
  @Get()
  @Header('cache-control', 'no-store')
  live(): { status: 'ok' } {
    return { status: 'ok' };
  }

  /** Readiness: every registered dependency answers; 503 if any does not (or while draining). */
  @Get('ready')
  @Header('cache-control', 'no-store')
  async ready(
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ status: 'ok' | 'unavailable'; checks: ReadinessReport['checks'] }> {
    const report = await this.readiness.run();
    res.status(report.ready ? HttpStatus.OK : HttpStatus.SERVICE_UNAVAILABLE);
    return { status: report.ready ? 'ok' : 'unavailable', checks: report.checks };
  }
}
