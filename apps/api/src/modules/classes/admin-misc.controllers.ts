import { Body, Controller, Header } from '@nestjs/common';
import { API, tenantAccess, type IdParams } from '@remix/types/api';
import {
  CurrentSession,
  CurrentTenant,
  Public,
  RequirePermission,
} from '../../common/auth/auth.decorators';
import type { AuthSession } from '../../common/auth/session-authenticator';
import { TenantAccess, tenantUnavailable } from '../../common/tenant/tenant-access.guard';
import type { ResolvedTenant } from '../../common/tenant/tenant-resolver';
import { Endpoint, type EndpointBody, type EndpointResult } from '../../common/validation/endpoint';
import { EndpointParams, EndpointQuery } from '../../common/validation/request-input';
import { DashboardService } from './dashboard.service';
import { HallsService } from './halls.service';
import { SettingsService } from './settings.service';
import { TimetableService } from './timetable.service';

type TimetableQuery = { weekStart?: string | undefined };

/** CLS-05 — halls. Reading needs `classes.read` (class forms), changing needs `classes.write`. */
@Controller()
export class HallsController {
  constructor(private readonly halls: HallsService) {}

  @RequirePermission('classes.read')
  @Header('cache-control', 'no-store')
  @Endpoint(API.listHalls)
  list(@CurrentTenant() tenant: ResolvedTenant): Promise<EndpointResult<typeof API.listHalls>> {
    return this.halls.list(tenant.id);
  }

  @RequirePermission('classes.write')
  @Endpoint(API.createHall, { status: 201 })
  create(
    @CurrentSession() session: AuthSession,
    @CurrentTenant() tenant: ResolvedTenant,
    @Body() body: EndpointBody<typeof API.createHall>,
  ): Promise<EndpointResult<typeof API.createHall>> {
    return this.halls.create(tenant.id, session, body);
  }

  @RequirePermission('classes.write')
  @Endpoint(API.updateHall)
  update(
    @CurrentSession() session: AuthSession,
    @CurrentTenant() tenant: ResolvedTenant,
    @EndpointParams() params: IdParams,
    @Body() body: EndpointBody<typeof API.updateHall>,
  ): Promise<EndpointResult<typeof API.updateHall>> {
    return this.halls.update(tenant.id, session, params.id, body);
  }

  @RequirePermission('classes.write')
  @Endpoint(API.deleteHall)
  delete(
    @CurrentSession() session: AuthSession,
    @CurrentTenant() tenant: ResolvedTenant,
    @EndpointParams() params: IdParams,
  ): Promise<undefined> {
    return this.halls.delete(tenant.id, session, params.id);
  }
}

/** CLS-06 — the weekly timetable: staff view (student counts) and the public website view. */
@Controller()
export class TimetableController {
  constructor(private readonly timetable: TimetableService) {}

  @RequirePermission('classes.read')
  @Header('cache-control', 'no-store')
  @Endpoint(API.timetable)
  admin(
    @CurrentSession() session: AuthSession,
    @CurrentTenant() tenant: ResolvedTenant,
    @EndpointQuery() query: TimetableQuery,
  ): Promise<EndpointResult<typeof API.timetable>> {
    return this.timetable.admin(tenant.id, session, query);
  }

  /**
   * Public: no session, no student counts. Only while the institute's public site is allowed
   * (TEN-06): a suspended or cancelled institute answers 403 `TENANT_UNAVAILABLE` like its site.
   */
  @Public()
  @TenantAccess('always')
  @Header('cache-control', 'public, max-age=60')
  @Endpoint(API.publicTimetable)
  publicWeek(
    @CurrentTenant() tenant: ResolvedTenant,
    @EndpointQuery() query: TimetableQuery,
  ): Promise<EndpointResult<typeof API.publicTimetable>> {
    if (!tenantAccess(tenant.status).publicSite) throw tenantUnavailable();
    return this.timetable.publicWeek(tenant.id, query);
  }
}

/** Admin dashboard counts and today's classes (`dashboard.view`). */
@Controller()
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @RequirePermission('dashboard.view')
  @Header('cache-control', 'no-store')
  @Endpoint(API.dashboard)
  get(
    @CurrentSession() session: AuthSession,
    @CurrentTenant() tenant: ResolvedTenant,
  ): Promise<EndpointResult<typeof API.dashboard>> {
    return this.dashboard.get(tenant.id, session);
  }
}

/** TEN-03 and Settings → General: owner only (`settings.manage`). */
@Controller()
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

  @RequirePermission('settings.manage')
  @Header('cache-control', 'no-store')
  @Endpoint(API.getTheme)
  theme(@CurrentTenant() tenant: ResolvedTenant): Promise<EndpointResult<typeof API.getTheme>> {
    return this.settings.getTheme(tenant.id);
  }

  @RequirePermission('settings.manage')
  @Header('cache-control', 'no-store')
  @Endpoint(API.updateTheme)
  updateTheme(
    @CurrentSession() session: AuthSession,
    @CurrentTenant() tenant: ResolvedTenant,
    @Body() body: EndpointBody<typeof API.updateTheme>,
  ): Promise<EndpointResult<typeof API.updateTheme>> {
    return this.settings.updateTheme(tenant.id, session, body);
  }

  @RequirePermission('settings.manage')
  @Header('cache-control', 'no-store')
  @Endpoint(API.getGeneralSettings)
  general(
    @CurrentTenant() tenant: ResolvedTenant,
  ): Promise<EndpointResult<typeof API.getGeneralSettings>> {
    return this.settings.getGeneral(tenant.id);
  }

  @RequirePermission('settings.manage')
  @Header('cache-control', 'no-store')
  @Endpoint(API.updateGeneralSettings)
  updateGeneral(
    @CurrentSession() session: AuthSession,
    @CurrentTenant() tenant: ResolvedTenant,
    @Body() body: EndpointBody<typeof API.updateGeneralSettings>,
  ): Promise<EndpointResult<typeof API.updateGeneralSettings>> {
    return this.settings.updateGeneral(tenant.id, session, body);
  }
}
