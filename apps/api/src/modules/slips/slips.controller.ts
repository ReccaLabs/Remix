import { Body, Controller, Header } from '@nestjs/common';
import { API, type IdParams } from '@remix/types/api';
import type { z } from 'zod';
import { CurrentSession, CurrentTenant, RequirePermission, SessionKinds } from '../../common/auth/auth.decorators';
import type { AuthSession } from '../../common/auth/session-authenticator';
import { RateLimit } from '../../common/rate-limit/rate-limit.guard';
import type { ResolvedTenant } from '../../common/tenant/tenant-resolver';
import { Endpoint, type EndpointBody } from '../../common/validation/endpoint';
import { EndpointParams, EndpointQuery } from '../../common/validation/request-input';
import { SlipsService } from './slips.service';

/** FEE-05 (student upload/submit) and FEE-06 (cashier queue). Every response is `no-store`. */
@Controller()
export class SlipsController {
  constructor(private readonly slips: SlipsService) {}

  @SessionKinds('student')
  @RateLimit({ name: 'slip-upload', limit: 20, windowSec: 60 * 60, by: 'user' })
  @Header('cache-control', 'no-store')
  @Endpoint(API.requestSlipUpload)
  requestSlipUpload(
    @CurrentTenant() t: ResolvedTenant,
    @CurrentSession() s: AuthSession,
    @Body() b: EndpointBody<typeof API.requestSlipUpload>,
  ) {
    return this.slips.requestUpload(t.id, s, b);
  }

  @SessionKinds('student')
  @RateLimit({ name: 'slip-submit', limit: 10, windowSec: 60 * 60, by: 'user' })
  @Header('cache-control', 'no-store')
  @Endpoint(API.submitSlip)
  submitSlip(
    @CurrentTenant() t: ResolvedTenant,
    @CurrentSession() s: AuthSession,
    @Body() b: EndpointBody<typeof API.submitSlip>,
  ) {
    return this.slips.submit(t.id, s, b);
  }

  @RequirePermission('fees.read')
  @Header('cache-control', 'no-store')
  @Endpoint(API.listSlips)
  listSlips(@CurrentTenant() t: ResolvedTenant, @EndpointQuery() q: z.output<typeof API.listSlips.query>) {
    return this.slips.list(t.id, q);
  }

  @RequirePermission('fees.read')
  @Header('cache-control', 'no-store')
  @Endpoint(API.getSlip)
  getSlip(@CurrentTenant() t: ResolvedTenant, @EndpointParams() p: IdParams) {
    return this.slips.get(t.id, p.id);
  }

  @RequirePermission('fees.read')
  @RateLimit({ name: 'slip-image', limit: 240, windowSec: 60, by: 'user' })
  @Header('cache-control', 'no-store')
  @Endpoint(API.slipImage)
  slipImage(@CurrentTenant() t: ResolvedTenant, @CurrentSession() s: AuthSession, @EndpointParams() p: IdParams) {
    return this.slips.image(t.id, s, p.id);
  }

  @RequirePermission('fees.collect')
  @RateLimit({ name: 'slip-review', limit: 120, windowSec: 60, by: 'user' })
  @Header('cache-control', 'no-store')
  @Endpoint(API.approveSlip)
  approveSlip(
    @CurrentTenant() t: ResolvedTenant,
    @CurrentSession() s: AuthSession,
    @EndpointParams() p: IdParams,
    @Body() b: EndpointBody<typeof API.approveSlip>,
  ) {
    return this.slips.approve(t.id, s, p.id, b.confirmDuplicate);
  }

  @RequirePermission('fees.collect')
  @RateLimit({ name: 'slip-review', limit: 120, windowSec: 60, by: 'user' })
  @Header('cache-control', 'no-store')
  @Endpoint(API.rejectSlip)
  rejectSlip(
    @CurrentTenant() t: ResolvedTenant,
    @CurrentSession() s: AuthSession,
    @EndpointParams() p: IdParams,
    @Body() b: EndpointBody<typeof API.rejectSlip>,
  ) {
    return this.slips.reject(t.id, s, p.id, b.reason);
  }
}
