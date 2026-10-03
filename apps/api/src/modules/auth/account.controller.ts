import { Body, Controller, Header, Param, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { can } from '@remix/types';
import { API, idParamsSchema, studentDeviceParamsSchema } from '@remix/types/api';
import { SessionKinds } from '../../common/auth/auth.decorators';
import { AppException } from '../../common/errors/app-exception';
import { RateLimit } from '../../common/rate-limit/rate-limit.guard';
import { Endpoint, type EndpointBody, type EndpointResult } from '../../common/validation/endpoint';
import { AccountService } from './account.service';
import { AuthCookies } from './auth-cookies';
import { sessionRecordOf, type SessionRecord } from './session.service';

function recordOf(req: Request): SessionRecord {
  const record = sessionRecordOf(req);
  // The auth guard only lets these routes run with a session the authenticator attached.
  if (!record) throw new AppException('UNAUTHENTICATED', 401);
  return record;
}

/** Path params are validated like bodies: a malformed id is a 400, never a query. */
function parseParams<T>(schema: { parse(v: unknown): T }, params: unknown): T {
  return schema.parse(params);
}

/**
 * AUTH-04 — the signed-in user's own account, any kind (students and staff). Every route needs a
 * session (deny by default) and acts only on that session's user.
 */
@Controller()
export class AccountController {
  constructor(
    private readonly accounts: AccountService,
    private readonly cookies: AuthCookies,
  ) {}

  @RateLimit({ name: 'me-update', limit: 30, windowSec: 60, by: 'user' })
  @Header('cache-control', 'no-store')
  @Endpoint(API.updateMe)
  async updateMe(
    @Body() body: EndpointBody<typeof API.updateMe>,
    @Req() req: Request,
  ): Promise<EndpointResult<typeof API.updateMe>> {
    await this.accounts.updateLocale(recordOf(req), body.locale);
    return undefined;
  }

  /** Revokes every session of the user; this device continues on a fresh session cookie. */
  @RateLimit({ name: 'me-password', limit: 5, windowSec: 15 * 60, by: 'user' })
  @Header('cache-control', 'no-store')
  @Endpoint(API.changePassword)
  async changePassword(
    @Body() body: EndpointBody<typeof API.changePassword>,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<EndpointResult<typeof API.changePassword>> {
    const result = await this.accounts.changePassword(recordOf(req), {
      ...body,
      headers: req.headers,
    });
    this.cookies.session(res, result.sessionToken, result.session);
    return undefined;
  }

  @Header('cache-control', 'no-store')
  @Endpoint(API.myDevices)
  myDevices(@Req() req: Request): Promise<EndpointResult<typeof API.myDevices>> {
    return this.accounts.devices(recordOf(req));
  }

  /** Signing out the current device also ends this session and clears its cookie. */
  @RateLimit({ name: 'me-devices', limit: 30, windowSec: 60, by: 'user' })
  @Header('cache-control', 'no-store')
  @Endpoint(API.signOutMyDevice)
  async signOutMyDevice(
    @Param() params: unknown,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<EndpointResult<typeof API.signOutMyDevice>> {
    const { id } = parseParams(idParamsSchema, params);
    const wasCurrent = await this.accounts.signOutOwnDevice(recordOf(req), id);
    if (wasCurrent) this.cookies.clearSession(res);
    return undefined;
  }
}

/**
 * AUTH-08 — staff with `students.devices` (owner, admin) sign out a student's device or reset
 * the student's password. Permission is checked here with `can()` (deny by default) and the
 * student is looked up inside the staff member's tenant, so another institute's ids are 404.
 */
@Controller()
@SessionKinds('staff')
export class AdminStudentAuthController {
  constructor(private readonly accounts: AccountService) {}

  @RateLimit({ name: 'admin-student-devices', limit: 60, windowSec: 60, by: 'user' })
  @Header('cache-control', 'no-store')
  @Endpoint(API.signOutStudentDevice)
  async signOutStudentDevice(
    @Param() params: unknown,
    @Req() req: Request,
  ): Promise<EndpointResult<typeof API.signOutStudentDevice>> {
    const staff = requirePermission(req);
    const { id, deviceId } = parseParams(studentDeviceParamsSchema, params);
    await this.accounts.signOutStudentDevice(staff, id, deviceId);
    return undefined;
  }

  @RateLimit({ name: 'admin-student-reset', limit: 30, windowSec: 15 * 60, by: 'user' })
  @Header('cache-control', 'no-store')
  @Endpoint(API.resetStudentPassword)
  async resetStudentPassword(
    @Param() params: unknown,
    @Req() req: Request,
  ): Promise<EndpointResult<typeof API.resetStudentPassword>> {
    const staff = requirePermission(req);
    const { id } = parseParams(idParamsSchema, params);
    await this.accounts.resetStudentPassword(staff, id);
    return undefined;
  }
}

function requirePermission(req: Request): SessionRecord {
  const record = recordOf(req);
  if (record.kind !== 'staff' || !can(record.roles, 'students.devices')) {
    throw new AppException('FORBIDDEN', 403);
  }
  return record;
}
