import { Body, Controller, Header, Inject, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { API, type UserKind } from '@remix/types/api';
import { CurrentTenant, Public } from '../../common/auth/auth.decorators';
import { AppException } from '../../common/errors/app-exception';
import { RateLimit, type RateLimitRule } from '../../common/rate-limit/rate-limit.guard';
import { TenantAccess } from '../../common/tenant/tenant-access.guard';
import type { ResolvedTenant } from '../../common/tenant/tenant-resolver';
import { CLOCK, type Clock } from '../../common/time/clock';
import { Endpoint, type EndpointBody, type EndpointResult } from '../../common/validation/endpoint';
import { APP_CONFIG, type AppConfig } from '../../config/config';
import { clearSessionCookies, cookieNames, serializeCookie } from './cookies';
import { DEVICE_COOKIE_MAX_AGE_SEC, sessionCookieMaxAge } from './lifetimes';
import { loginIdentifierKey, LoginService, type LoginResult } from './login.service';
import {
  sessionRecordOf,
  SessionService,
  toSessionResponse,
  type SessionRecord,
} from './session.service';

/**
 * AUTH-09 (basic): 5 attempts/min per phone or email and 20/min per client IP, shared by both
 * login endpoints. Keys are tenant-prefixed and hashed by the rate-limit guard.
 *
 * Order matters: the guard stops at the first blocking rule, so checking the IP first means a
 * client already over its IP budget never creates new identifier keys — it can't fill the
 * limiter's key map and lock other users' first attempts out (review finding N-1).
 */
const loginLimits = (kind: UserKind): [RateLimitRule, RateLimitRule] => [
  { name: 'login-ip', limit: 20, windowSec: 60, by: 'ip' },
  { name: 'login-id', limit: 5, windowSec: 60, by: (req) => loginIdentifierKey(kind, req.body) },
];

/**
 * Login, session, refresh and logout (ADR 0004). Every response is `Cache-Control: no-store`.
 * The session token only ever travels in `Set-Cookie`, never in a body.
 */
@Controller()
export class AuthController {
  private readonly names: ReturnType<typeof cookieNames>;

  constructor(
    private readonly logins: LoginService,
    private readonly sessions: SessionService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {
    this.names = cookieNames(config.cookieSecure);
  }

  /** AUTH-01 — 403 TENANT_UNAVAILABLE when the tenant's students are locked out (TEN-06). */
  @Public()
  @RateLimit(...loginLimits('student'))
  @Header('cache-control', 'no-store')
  @Endpoint(API.studentLogin)
  async studentLogin(
    @Body() body: EndpointBody<typeof API.studentLogin>,
    @CurrentTenant() tenant: ResolvedTenant,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<EndpointResult<typeof API.studentLogin>> {
    const result = await this.logins.studentLogin(tenant, {
      phone: body.phone,
      password: body.password,
      staySignedIn: body.staySignedIn,
      headers: req.headers,
    });
    return this.signedIn(res, result);
  }

  /** AUTH-05 basic (2-step SMS is Phase 2) — staff of a cancelled tenant get TENANT_UNAVAILABLE. */
  @Public()
  @RateLimit(...loginLimits('staff'))
  @Header('cache-control', 'no-store')
  @Endpoint(API.staffLogin)
  async staffLogin(
    @Body() body: EndpointBody<typeof API.staffLogin>,
    @CurrentTenant() tenant: ResolvedTenant,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<EndpointResult<typeof API.staffLogin>> {
    const result = await this.logins.staffLogin(tenant, {
      identifier: body.identifier,
      password: body.password,
      staySignedIn: body.staySignedIn,
      headers: req.headers,
    });
    return this.signedIn(res, result);
  }

  /** The signed-in user on this host. Billing-only staff may read it (TEN-06). */
  @TenantAccess('session')
  @Header('cache-control', 'no-store')
  @Endpoint(API.session)
  session(@Req() req: Request): EndpointResult<typeof API.session> {
    return toSessionResponse(this.recordOf(req));
  }

  /**
   * Rotate the token when it is at least 15 min old and set the new cookie (200 + Set-Cookie).
   * Otherwise a no-op: 200 without Set-Cookie — including a request that authenticated with the
   * previous token inside the grace window, whose superseding rotation carried the new cookie.
   * An ended session is 401 from the auth guard. Called server-to-server by the web proxy.
   */
  @TenantAccess('session')
  @Header('cache-control', 'no-store')
  @Endpoint(API.refreshSession)
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<EndpointResult<typeof API.refreshSession>> {
    const result = await this.sessions.refresh(this.recordOf(req));
    if (result.rotated) this.setSessionCookie(res, result.token, result.session);
    return toSessionResponse(result.session);
  }

  /** Revoke the session (if any) and clear both cookie variants. Always 204. */
  @Public({ optionalSession: true })
  @TenantAccess('always')
  @Header('cache-control', 'no-store')
  @Endpoint(API.logout)
  async logout(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<EndpointResult<typeof API.logout>> {
    const record = sessionRecordOf(req);
    if (record) await this.sessions.logout(record);
    res.append('Set-Cookie', clearSessionCookies(this.config.cookieSecure));
    return undefined;
  }

  private signedIn(res: Response, result: LoginResult): EndpointResult<typeof API.studentLogin> {
    this.setSessionCookie(res, result.sessionToken, result.session);
    // Re-set on every login, so a known device's cookie keeps its full 400-day life.
    res.append(
      'Set-Cookie',
      serializeCookie(this.names.device, result.deviceToken, {
        secure: this.config.cookieSecure,
        maxAge: DEVICE_COOKIE_MAX_AGE_SEC,
      }),
    );
    return toSessionResponse(result.session);
  }

  private setSessionCookie(res: Response, token: string, session: SessionRecord): void {
    const maxAge = sessionCookieMaxAge(session, this.clock.now());
    res.append(
      'Set-Cookie',
      serializeCookie(this.names.session, token, {
        secure: this.config.cookieSecure,
        ...(maxAge === undefined ? {} : { maxAge }),
      }),
    );
  }

  private recordOf(req: Request): SessionRecord {
    const record = sessionRecordOf(req);
    // The auth guard only lets these routes run with a session the authenticator attached.
    if (!record) throw new AppException('UNAUTHENTICATED', 401);
    return record;
  }
}
