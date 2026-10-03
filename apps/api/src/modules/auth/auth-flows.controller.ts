import { Body, Controller, Header, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { API, OTP_RULES, otpVerifySchema } from '@remix/types/api';
import { CurrentTenant, Public } from '../../common/auth/auth.decorators';
import { RateLimit, type RateLimitRule } from '../../common/rate-limit/rate-limit.guard';
import type { ResolvedTenant } from '../../common/tenant/tenant-resolver';
import { Endpoint, type EndpointBody, type EndpointResult } from '../../common/validation/endpoint';
import { AuthCookies } from './auth-cookies';
import { InviteService } from './invite.service';
import { LoginService } from './login.service';
import { OtpService } from './otp.service';
import { toSessionResponse } from './session.service';

const FIFTEEN_MIN = 15 * 60;

/**
 * Public, rate-limited auth steps (AUTH-02/03/05/07/09). Guard limits here are per client IP and
 * per institute — they answer 429 for everyone alike, so they reveal nothing about accounts. The
 * per-phone SMS limits that must stay invisible live in the services (CodeSendLimits). Every
 * rule fails closed (503) when Valkey is down.
 */
const ipRule = (name: string, limit: number, windowSec = FIFTEEN_MIN): RateLimitRule => ({
  name,
  limit,
  windowSec,
  by: 'ip',
});

/** SMS-fraud ceiling per institute (T7): a botnet rotating IPs still cannot drain its SMS. */
const tenantSmsRule: RateLimitRule = {
  name: 'otp-tenant',
  limit: 300,
  windowSec: FIFTEEN_MIN,
  by: () => 'tenant',
};

/** Guesses per phone across IPs: 10 per 15 minutes, on top of 5 per code. */
const verifyPhoneRule: RateLimitRule = {
  name: 'otp-verify-phone',
  limit: 10,
  windowSec: FIFTEEN_MIN,
  by: (req) => {
    const parsed = otpVerifySchema.safeParse(req.body);
    return parsed.success ? `phone:${parsed.data.phone}` : null;
  },
};

@Controller()
export class AuthFlowsController {
  constructor(
    private readonly otp: OtpService,
    private readonly logins: LoginService,
    private readonly invites: InviteService,
    private readonly cookies: AuthCookies,
  ) {}

  /** Always 202 with the same body (no enumeration); the SMS is queued only for an account. */
  @Public()
  @RateLimit(ipRule('otp-request-ip', 10), tenantSmsRule)
  @Header('cache-control', 'no-store')
  @Endpoint(API.requestOtp, { status: 202 })
  async requestOtp(
    @Body() body: EndpointBody<typeof API.requestOtp>,
    @CurrentTenant() tenant: ResolvedTenant,
  ): Promise<EndpointResult<typeof API.requestOtp>> {
    await this.otp.request(tenant, body);
    return { resendAfterSeconds: OTP_RULES.resendAfterSeconds };
  }

  @Public()
  @RateLimit(ipRule('otp-verify-ip', 30), verifyPhoneRule)
  @Header('cache-control', 'no-store')
  @Endpoint(API.verifyOtp)
  verifyOtp(
    @Body() body: EndpointBody<typeof API.verifyOtp>,
    @CurrentTenant() tenant: ResolvedTenant,
  ): Promise<EndpointResult<typeof API.verifyOtp>> {
    return this.otp.verify(tenant, body);
  }

  @Public()
  @RateLimit(ipRule('password-set-ip', 20))
  @Header('cache-control', 'no-store')
  @Endpoint(API.setPassword)
  async setPassword(
    @Body() body: EndpointBody<typeof API.setPassword>,
    @CurrentTenant() tenant: ResolvedTenant,
  ): Promise<EndpointResult<typeof API.setPassword>> {
    await this.otp.setPassword(tenant, body);
    return undefined;
  }

  @Public()
  @RateLimit(ipRule('device-limit-ip', 30))
  @Header('cache-control', 'no-store')
  @Endpoint(API.resolveDeviceLimit)
  async resolveDeviceLimit(
    @Body() body: EndpointBody<typeof API.resolveDeviceLimit>,
    @CurrentTenant() tenant: ResolvedTenant,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<EndpointResult<typeof API.resolveDeviceLimit>> {
    const result = await this.logins.resolveDeviceLimit(tenant, { ...body, headers: req.headers });
    this.cookies.signedIn(res, result);
    return toSessionResponse(result.session);
  }

  @Public()
  @RateLimit(ipRule('two-step-ip', 30))
  @Header('cache-control', 'no-store')
  @Endpoint(API.verifyTwoStep)
  async verifyTwoStep(
    @Body() body: EndpointBody<typeof API.verifyTwoStep>,
    @CurrentTenant() tenant: ResolvedTenant,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<EndpointResult<typeof API.verifyTwoStep>> {
    const result = await this.logins.verifyTwoStep(tenant, { ...body, headers: req.headers });
    this.cookies.signedIn(res, result);
    if (result.trustToken) this.cookies.trust(res, result.trustToken);
    return toSessionResponse(result.session);
  }

  @Public()
  @RateLimit(ipRule('two-step-resend-ip', 10), tenantSmsRule)
  @Header('cache-control', 'no-store')
  @Endpoint(API.resendTwoStep)
  resendTwoStep(
    @Body() body: EndpointBody<typeof API.resendTwoStep>,
    @CurrentTenant() tenant: ResolvedTenant,
  ): Promise<EndpointResult<typeof API.resendTwoStep>> {
    return this.logins.resendTwoStep(tenant, body.token);
  }

  @Public()
  @RateLimit(ipRule('invite-ip', 30))
  @Header('cache-control', 'no-store')
  @Endpoint(API.previewInvite)
  previewInvite(
    @Body() body: EndpointBody<typeof API.previewInvite>,
    @CurrentTenant() tenant: ResolvedTenant,
  ): Promise<EndpointResult<typeof API.previewInvite>> {
    return this.invites.preview(tenant, body.token);
  }

  @Public()
  @RateLimit(ipRule('invite-ip', 30))
  @Header('cache-control', 'no-store')
  @Endpoint(API.acceptInvite)
  async acceptInvite(
    @Body() body: EndpointBody<typeof API.acceptInvite>,
    @CurrentTenant() tenant: ResolvedTenant,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<EndpointResult<typeof API.acceptInvite>> {
    const result = await this.invites.accept(tenant, { ...body, headers: req.headers });
    this.cookies.signedIn(res, result);
    return toSessionResponse(result.session);
  }
}
