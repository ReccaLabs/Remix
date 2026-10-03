import { Body, Controller, Header } from '@nestjs/common';
import { API, type IdParams } from '@remix/types/api';
import type { z } from 'zod';
import {
  CurrentSession,
  CurrentTenant,
  RequirePermission,
} from '../../common/auth/auth.decorators';
import type { AuthSession } from '../../common/auth/session-authenticator';
import { RateLimit } from '../../common/rate-limit/rate-limit.guard';
import type { ResolvedTenant } from '../../common/tenant/tenant-resolver';
import { Endpoint, type EndpointBody, type EndpointResult } from '../../common/validation/endpoint';
import { EndpointParams, EndpointQuery } from '../../common/validation/request-input';
import { StudentsService } from './students.service';

type ListQuery = z.output<(typeof API.listStudents)['query']>;

/**
 * Admin students (STU-01/02/03/05/07, PAR-01/03). Permission per `ROLE_PERMISSIONS`: staff with
 * `students.read` list and open profiles (teachers only their classes' students), `students.write`
 * creates, edits, archives and moves. Responses contain personal data, so none is cacheable.
 */
@Controller()
export class StudentsController {
  constructor(private readonly students: StudentsService) {}

  @RequirePermission('students.read')
  @Header('cache-control', 'no-store')
  @Endpoint(API.listStudents)
  list(
    @CurrentSession() session: AuthSession,
    @CurrentTenant() tenant: ResolvedTenant,
    @EndpointQuery() query: ListQuery,
  ): Promise<EndpointResult<typeof API.listStudents>> {
    return this.students.list(tenant.id, session, query);
  }

  /** Each student with `sendWelcomeSms` costs an SMS, so creation is rate limited per user. */
  @RequirePermission('students.write')
  @RateLimit({ name: 'student-create', limit: 300, windowSec: 3600, by: 'user' })
  @Header('cache-control', 'no-store')
  @Endpoint(API.createStudent, { status: 201 })
  create(
    @CurrentSession() session: AuthSession,
    @CurrentTenant() tenant: ResolvedTenant,
    @Body() body: EndpointBody<typeof API.createStudent>,
  ): Promise<EndpointResult<typeof API.createStudent>> {
    return this.students.create(tenant.id, session, body);
  }

  @RequirePermission('students.read')
  @Header('cache-control', 'no-store')
  @Endpoint(API.getStudent)
  get(
    @CurrentSession() session: AuthSession,
    @CurrentTenant() tenant: ResolvedTenant,
    @EndpointParams() params: IdParams,
  ): Promise<EndpointResult<typeof API.getStudent>> {
    return this.students.get(tenant.id, session, params.id);
  }

  @RequirePermission('students.write')
  @Header('cache-control', 'no-store')
  @Endpoint(API.updateStudent)
  update(
    @CurrentSession() session: AuthSession,
    @CurrentTenant() tenant: ResolvedTenant,
    @EndpointParams() params: IdParams,
    @Body() body: EndpointBody<typeof API.updateStudent>,
  ): Promise<EndpointResult<typeof API.updateStudent>> {
    return this.students.update(tenant.id, session, params.id, body);
  }

  /** `sign_out_devices` additionally needs `students.devices` (checked in the service). */
  @RequirePermission('students.write')
  @Header('cache-control', 'no-store')
  @Endpoint(API.bulkStudents)
  bulk(
    @CurrentSession() session: AuthSession,
    @CurrentTenant() tenant: ResolvedTenant,
    @Body() body: EndpointBody<typeof API.bulkStudents>,
  ): Promise<EndpointResult<typeof API.bulkStudents>> {
    return this.students.bulk(tenant.id, session, body);
  }
}
