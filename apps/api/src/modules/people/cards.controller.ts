import { Body, Controller, Header } from '@nestjs/common';
import { API, type IdParams } from '@remix/types/api';
import {
  CurrentSession,
  CurrentTenant,
  RequirePermission,
} from '../../common/auth/auth.decorators';
import type { AuthSession } from '../../common/auth/session-authenticator';
import { contextOf } from '../../common/context/request-context';
import { RateLimit } from '../../common/rate-limit/rate-limit.guard';
import type { ResolvedTenant } from '../../common/tenant/tenant-resolver';
import { Endpoint, type EndpointBody, type EndpointResult } from '../../common/validation/endpoint';
import { EndpointParams } from '../../common/validation/request-input';
import { CardsService } from './cards.service';

@Controller()
export class CardsController {
  constructor(private readonly cards: CardsService) {}

  @RequirePermission('students.read')
  @Header('cache-control', 'no-store')
  @Endpoint(API.listStudentCards)
  list(
    @CurrentTenant() tenant: ResolvedTenant,
    @EndpointParams() params: IdParams,
  ): Promise<EndpointResult<typeof API.listStudentCards>> {
    return this.cards.list(tenant.id, params.id);
  }

  @RequirePermission('students.write')
  @Header('cache-control', 'no-store')
  @Endpoint(API.issueStudentCard, { status: 201 })
  issue(
    @CurrentTenant() tenant: ResolvedTenant,
    @CurrentSession() session: AuthSession,
    @EndpointParams() params: IdParams,
    @Body() body: EndpointBody<typeof API.issueStudentCard>,
  ): Promise<EndpointResult<typeof API.issueStudentCard>> {
    return this.cards.issue(tenant.id, session, params.id, body);
  }

  @RequirePermission('students.write')
  @Header('cache-control', 'no-store')
  @Endpoint(API.activateStudentCard)
  activate(
    @CurrentTenant() tenant: ResolvedTenant,
    @CurrentSession() session: AuthSession,
    @EndpointParams() params: IdParams,
    @Body() body: EndpointBody<typeof API.activateStudentCard>,
  ): Promise<EndpointResult<typeof API.activateStudentCard>> {
    return this.cards.activate(tenant.id, session, params.id, body);
  }

  @RequirePermission('students.write')
  @Header('cache-control', 'no-store')
  @Endpoint(API.revokeStudentCard)
  revoke(
    @CurrentTenant() tenant: ResolvedTenant,
    @CurrentSession() session: AuthSession,
    @EndpointParams() params: IdParams,
    @Body() body: EndpointBody<typeof API.revokeStudentCard>,
  ): Promise<EndpointResult<typeof API.revokeStudentCard>> {
    return this.cards.revoke(tenant.id, session, params.id, body.reason);
  }

  @RequirePermission('students.read')
  @Header('cache-control', 'no-store')
  @Endpoint(API.listOrderedCards)
  ordered(
    @CurrentTenant() tenant: ResolvedTenant,
  ): Promise<EndpointResult<typeof API.listOrderedCards>> {
    return this.cards.ordered(tenant.id);
  }

  @RequirePermission('students.read')
  @RateLimit({
    name: 'card-lookup',
    limit: 60,
    windowSec: 60,
    by: (req) => contextOf(req)?.session?.sessionId,
  })
  @Header('cache-control', 'no-store')
  @Endpoint(API.lookupCard)
  lookup(
    @CurrentTenant() tenant: ResolvedTenant,
    @Body() body: EndpointBody<typeof API.lookupCard>,
  ): Promise<EndpointResult<typeof API.lookupCard>> {
    return this.cards.lookup(tenant.id, body.input);
  }
}
