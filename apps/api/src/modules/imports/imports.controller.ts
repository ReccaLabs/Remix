import { Body, Controller, Header } from '@nestjs/common';
import { API, type IdParams } from '@remix/types/api';
import {
  CurrentSession,
  CurrentTenant,
  RequirePermission,
} from '../../common/auth/auth.decorators';
import type { AuthSession } from '../../common/auth/session-authenticator';
import { RateLimit } from '../../common/rate-limit/rate-limit.guard';
import type { ResolvedTenant } from '../../common/tenant/tenant-resolver';
import { Endpoint, type EndpointBody, type EndpointResult } from '../../common/validation/endpoint';
import { EndpointParams } from '../../common/validation/request-input';
import { ImportsService } from './imports.service';

/**
 * Student import (STU-04 / DAT-01). All three need `students.import` (owner and admin). Bodies
 * carry up to 5,000 rows of personal data: never cacheable, and the large-body limit applies to
 * these two POSTs only (see `bootstrap.ts`).
 */
@Controller()
export class ImportsController {
  constructor(private readonly imports: ImportsService) {}

  /** A dry run reads the whole file against the database: rate limited per user. */
  @RequirePermission('students.import')
  @RateLimit({ name: 'import-preview', limit: 60, windowSec: 3600, by: 'user' })
  @Header('cache-control', 'no-store')
  @Endpoint(API.previewStudentImport)
  preview(
    @CurrentTenant() tenant: ResolvedTenant,
    @Body() body: EndpointBody<typeof API.previewStudentImport>,
  ): Promise<EndpointResult<typeof API.previewStudentImport>> {
    return this.imports.preview(tenant.id, body);
  }

  @RequirePermission('students.import')
  @RateLimit({ name: 'import-commit', limit: 20, windowSec: 3600, by: 'user' })
  @Header('cache-control', 'no-store')
  @Endpoint(API.commitStudentImport, { status: 202 })
  commit(
    @CurrentSession() session: AuthSession,
    @CurrentTenant() tenant: ResolvedTenant,
    @Body() body: EndpointBody<typeof API.commitStudentImport>,
  ): Promise<EndpointResult<typeof API.commitStudentImport>> {
    return this.imports.commit(tenant.id, session, body);
  }

  /** Polled by the wizard every second or two while a job runs. */
  @RequirePermission('students.import')
  @RateLimit({ name: 'import-get', limit: 600, windowSec: 600, by: 'user' })
  @Header('cache-control', 'no-store')
  @Endpoint(API.getImportJob)
  get(
    @CurrentTenant() tenant: ResolvedTenant,
    @EndpointParams() params: IdParams,
  ): Promise<EndpointResult<typeof API.getImportJob>> {
    return this.imports.get(tenant.id, params.id);
  }
}
