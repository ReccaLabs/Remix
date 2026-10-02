import { type CanActivate, type ExecutionContext, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { tenantAccess, type TenantStatus } from '@remix/types/api';
import type { AuthSession } from '../auth/session-authenticator';
import { contextOf } from '../context/request-context';
import { AppException } from '../errors/app-exception';

/**
 * What a route needs from the tenant's status (TEN-06, `tenantAccess` in `@remix/types`):
 * - `full` (default): students need `studentPortal`, staff need `staff: 'full'`.
 * - `session`: session housekeeping (read the session, refresh it). Billing-only staff pass;
 *   students still need `studentPortal`, staff of a cancelled tenant are refused — with 401
 *   `UNAUTHENTICATED` rather than 403, see the guard.
 * - `always`: no status check at all (logout must always succeed).
 */
export type TenantAccessLevel = 'full' | 'session' | 'always';

const TENANT_ACCESS = 'remix:tenantAccess';

export const TenantAccess = (level: TenantAccessLevel): MethodDecorator & ClassDecorator =>
  SetMetadata(TENANT_ACCESS, level);

export const TENANT_UNAVAILABLE_TITLE = 'This institute is not available right now';

/** 403 `TENANT_UNAVAILABLE`: the web app shows its "temporarily unavailable" screen. */
export function tenantUnavailable(): AppException {
  return new AppException('TENANT_UNAVAILABLE', 403, TENANT_UNAVAILABLE_TITLE);
}

/** Whether a signed-in user of `kind` may use a route of `level` while the tenant is `status`. */
export function sessionAllowed(
  status: TenantStatus,
  kind: AuthSession['kind'],
  level: TenantAccessLevel,
): boolean {
  if (level === 'always') return true;
  const access = tenantAccess(status);
  if (kind === 'student') return access.studentPortal;
  if (kind === 'staff') {
    if (access.staff === 'full') return true;
    return access.staff === 'billing-only' && level === 'session';
  }
  return false;
}

/**
 * Global guard after the auth guard: a session on a tenant host is checked against the tenant's
 * status, so a suspension locks students (and non-billing staff work) out immediately — even
 * with a session issued before it. Requests without a session are left to the route: the login
 * handlers check `tenantAccess` themselves before looking at credentials.
 */
@Injectable()
export class TenantAccessGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    if (context.getType() !== 'http') return true;
    const ctx = contextOf(context.switchToHttp().getRequest<Request>());
    if (ctx?.area !== 'tenant' || !ctx.tenant || !ctx.session) return true;
    const level =
      this.reflector.getAllAndOverride<TenantAccessLevel | undefined>(TENANT_ACCESS, [
        context.getHandler(),
        context.getClass(),
      ]) ?? 'full';
    if (sessionAllowed(ctx.tenant.status, ctx.session.kind, level)) return true;
    // Session housekeeping answers only "signed in" (200) or "not" (401): the web app treats
    // anything else from GET /auth/session or refresh as an outage. A session the tenant's
    // status no longer allows is therefore "not signed in" there; signing in again then
    // returns TENANT_UNAVAILABLE, which shows the unavailable screen.
    if (level === 'session') throw new AppException('UNAUTHENTICATED', 401);
    throw tenantUnavailable();
  }
}
