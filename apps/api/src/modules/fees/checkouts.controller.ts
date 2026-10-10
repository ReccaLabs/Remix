import { Body, Controller, Header, HttpCode, Param, Post, Req } from '@nestjs/common';
import { API, type IdParams } from '@remix/types/api';
import type { Request } from 'express';
import {
  CurrentSession,
  CurrentTenant,
  Public,
  SessionKinds,
} from '../../common/auth/auth.decorators';
import type { AuthSession } from '../../common/auth/session-authenticator';
import { requireContext } from '../../common/context/request-context';
import { AppException } from '../../common/errors/app-exception';
import { RateLimit } from '../../common/rate-limit/rate-limit.guard';
import { SkipCsrf } from '../../common/security/csrf.guard';
import type { ResolvedTenant } from '../../common/tenant/tenant-resolver';
import { Endpoint, type EndpointBody } from '../../common/validation/endpoint';
import { EndpointParams } from '../../common/validation/request-input';
import { CheckoutsService } from './checkouts.service';

/** FEE-04 card checkout for the signed-in student, and the return page's status poll. */
@Controller()
export class CheckoutsController {
  constructor(private readonly checkouts: CheckoutsService) {}

  @SessionKinds('student')
  @RateLimit({ name: 'checkout-create', limit: 10, windowSec: 60 * 60, by: 'user' })
  @Header('cache-control', 'no-store')
  @Endpoint(API.createCheckout)
  createCheckout(
    @CurrentTenant() t: ResolvedTenant,
    @CurrentSession() s: AuthSession,
    @Body() b: EndpointBody<typeof API.createCheckout>,
  ) {
    const origin = requireContext().origin;
    if (!origin) throw new Error('Missing validated request origin');
    return this.checkouts.create(t, s, b.lineIds, origin);
  }

  @SessionKinds('student')
  @RateLimit({ name: 'checkout-status', limit: 120, windowSec: 60, by: 'user' })
  @Header('cache-control', 'no-store')
  @Endpoint(API.checkoutStatus)
  checkoutStatus(
    @CurrentTenant() t: ResolvedTenant,
    @CurrentSession() s: AuthSession,
    @EndpointParams() p: IdParams,
  ) {
    return this.checkouts.status(t.id, s, p.id);
  }
}

/**
 * PayHere `notify_url`: server to server, form-encoded (parsed for this path only, see
 * bootstrap), no session and no CSRF check: the merchant-secret signature authenticates it
 * (ADR 0003, 0008 §6). The tenant comes from the host; the slug in the path must match it.
 */
@Controller()
export class PayhereWebhookController {
  constructor(private readonly checkouts: CheckoutsService) {}

  @Public()
  @SkipCsrf()
  // Signed and idempotent; losing a notification for money already taken is the worse failure.
  @RateLimit({ name: 'payhere-notify', limit: 300, windowSec: 60, by: 'ip', onOutage: 'allow' })
  @Post('webhooks/payhere/:tenantSlug')
  @HttpCode(200)
  @Header('cache-control', 'no-store')
  @Header('content-type', 'text/plain; charset=utf-8')
  async notify(
    @CurrentTenant() t: ResolvedTenant,
    @Param('tenantSlug') slug: string,
    @Req() req: Request,
  ): Promise<string> {
    if (slug !== t.slug) throw new AppException('NOT_FOUND', 404);
    // PayHere posts a form; nothing else is parsed as a notification.
    if (!req.is('application/x-www-form-urlencoded'))
      throw new AppException('VALIDATION_FAILED', 415, 'Notification rejected');
    await this.checkouts.notify(t, req.body as unknown);
    return 'OK';
  }
}
