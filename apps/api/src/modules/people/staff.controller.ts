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
import { StaffService } from './staff.service';

/** Settings → Staff and roles (STF-01/02/03). Owners only (`staff.manage`). */
@Controller()
export class StaffController {
  constructor(private readonly staff: StaffService) {}

  @RequirePermission('staff.manage')
  @Header('cache-control', 'no-store')
  @Endpoint(API.listStaff)
  list(@CurrentTenant() tenant: ResolvedTenant): Promise<EndpointResult<typeof API.listStaff>> {
    return this.staff.list(tenant.id);
  }

  /** Every invitation sends an SMS or email, so invitations are rate limited per user. */
  @RequirePermission('staff.manage')
  @RateLimit({ name: 'staff-invite', limit: 30, windowSec: 3600, by: 'user' })
  @Header('cache-control', 'no-store')
  @Endpoint(API.inviteStaff, { status: 201 })
  invite(
    @CurrentSession() session: AuthSession,
    @CurrentTenant() tenant: ResolvedTenant,
    @Body() body: EndpointBody<typeof API.inviteStaff>,
  ): Promise<EndpointResult<typeof API.inviteStaff>> {
    return this.staff.invite(tenant.id, session, body);
  }

  @RequirePermission('staff.manage')
  @Header('cache-control', 'no-store')
  @Endpoint(API.revokeInvite)
  revoke(
    @CurrentSession() session: AuthSession,
    @CurrentTenant() tenant: ResolvedTenant,
    @EndpointParams() params: IdParams,
  ): Promise<EndpointResult<typeof API.revokeInvite>> {
    return this.staff.revokeInvite(tenant.id, session, params.id).then(() => undefined);
  }

  @RequirePermission('staff.manage')
  @Header('cache-control', 'no-store')
  @Endpoint(API.updateStaff)
  update(
    @CurrentSession() session: AuthSession,
    @CurrentTenant() tenant: ResolvedTenant,
    @EndpointParams() params: IdParams,
    @Body() body: EndpointBody<typeof API.updateStaff>,
  ): Promise<EndpointResult<typeof API.updateStaff>> {
    return this.staff.update(tenant.id, session, params.id, body);
  }
}
