import { Body, Controller, Header } from '@nestjs/common';
import { API, type IdParams } from '@remix/types/api';
import type { z } from 'zod';
import {
  CurrentSession,
  CurrentTenant,
  RequirePermission,
} from '../../common/auth/auth.decorators';
import type { AuthSession } from '../../common/auth/session-authenticator';
import type { ResolvedTenant } from '../../common/tenant/tenant-resolver';
import { Endpoint, type EndpointBody, type EndpointResult } from '../../common/validation/endpoint';
import { EndpointParams, EndpointQuery } from '../../common/validation/request-input';
import { ClassesService } from './classes.service';

type ListQuery = z.output<(typeof API.listClasses)['query']>;

/**
 * Admin classes and enrolments (CLS-01…04). Permission per `ROLE_PERMISSIONS`: `classes.read`
 * lists and opens classes (teachers only their own, STF-02), `classes.write` creates, edits and
 * archives, `enrollments.write` enrols, changes fees and moves students.
 */
@Controller()
export class AdminClassesController {
  constructor(private readonly classes: ClassesService) {}

  @RequirePermission('classes.write')
  @Header('cache-control', 'no-store')
  @Endpoint(API.listTeachers)
  teachers(
    @CurrentTenant() tenant: ResolvedTenant,
  ): Promise<EndpointResult<typeof API.listTeachers>> {
    return this.classes.teachers(tenant.id);
  }

  @RequirePermission('classes.read')
  @Header('cache-control', 'no-store')
  @Endpoint(API.listClasses)
  list(
    @CurrentSession() session: AuthSession,
    @CurrentTenant() tenant: ResolvedTenant,
    @EndpointQuery() query: ListQuery,
  ): Promise<EndpointResult<typeof API.listClasses>> {
    return this.classes.list(tenant.id, session, query);
  }

  @RequirePermission('classes.write')
  @Header('cache-control', 'no-store')
  @Endpoint(API.createClass, { status: 201 })
  create(
    @CurrentSession() session: AuthSession,
    @CurrentTenant() tenant: ResolvedTenant,
    @Body() body: EndpointBody<typeof API.createClass>,
  ): Promise<EndpointResult<typeof API.createClass>> {
    return this.classes.create(tenant.id, session, body);
  }

  @RequirePermission('classes.read')
  @Header('cache-control', 'no-store')
  @Endpoint(API.getClass)
  get(
    @CurrentSession() session: AuthSession,
    @CurrentTenant() tenant: ResolvedTenant,
    @EndpointParams() params: IdParams,
  ): Promise<EndpointResult<typeof API.getClass>> {
    return this.classes.get(tenant.id, session, params.id);
  }

  @RequirePermission('classes.write')
  @Header('cache-control', 'no-store')
  @Endpoint(API.updateClass)
  update(
    @CurrentSession() session: AuthSession,
    @CurrentTenant() tenant: ResolvedTenant,
    @EndpointParams() params: IdParams,
    @Body() body: EndpointBody<typeof API.updateClass>,
  ): Promise<EndpointResult<typeof API.updateClass>> {
    return this.classes.update(tenant.id, session, params.id, body);
  }

  @RequirePermission('classes.write')
  @Endpoint(API.archiveClass)
  archive(
    @CurrentSession() session: AuthSession,
    @CurrentTenant() tenant: ResolvedTenant,
    @EndpointParams() params: IdParams,
  ): Promise<undefined> {
    return this.classes.archive(tenant.id, session, params.id);
  }

  @RequirePermission('classes.read')
  @Header('cache-control', 'no-store')
  @Endpoint(API.classStudents)
  students(
    @CurrentSession() session: AuthSession,
    @CurrentTenant() tenant: ResolvedTenant,
    @EndpointParams() params: IdParams,
  ): Promise<EndpointResult<typeof API.classStudents>> {
    return this.classes.classStudents(tenant.id, session, params.id);
  }

  @RequirePermission('enrollments.write')
  @Header('cache-control', 'no-store')
  @Endpoint(API.enrolStudents, { status: 201 })
  enrol(
    @CurrentSession() session: AuthSession,
    @CurrentTenant() tenant: ResolvedTenant,
    @EndpointParams() params: IdParams,
    @Body() body: EndpointBody<typeof API.enrolStudents>,
  ): Promise<EndpointResult<typeof API.enrolStudents>> {
    return this.classes.enrol(tenant.id, session, params.id, body);
  }

  @RequirePermission('enrollments.write')
  @Header('cache-control', 'no-store')
  @Endpoint(API.updateEnrollment)
  updateEnrollment(
    @CurrentSession() session: AuthSession,
    @CurrentTenant() tenant: ResolvedTenant,
    @EndpointParams() params: IdParams,
    @Body() body: EndpointBody<typeof API.updateEnrollment>,
  ): Promise<EndpointResult<typeof API.updateEnrollment>> {
    return this.classes.updateEnrollment(tenant.id, session, params.id, body);
  }

  @RequirePermission('enrollments.write')
  @Header('cache-control', 'no-store')
  @Endpoint(API.moveEnrollment)
  moveEnrollment(
    @CurrentSession() session: AuthSession,
    @CurrentTenant() tenant: ResolvedTenant,
    @EndpointParams() params: IdParams,
    @Body() body: EndpointBody<typeof API.moveEnrollment>,
  ): Promise<EndpointResult<typeof API.moveEnrollment>> {
    return this.classes.moveEnrollment(tenant.id, session, params.id, body);
  }
}
