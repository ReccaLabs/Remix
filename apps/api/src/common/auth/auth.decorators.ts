import { createParamDecorator, type ExecutionContext, SetMetadata } from '@nestjs/common';
import type { Permission } from '@remix/types';
import type { Request } from 'express';
import { contextOf } from '../context/request-context';
import type { ResolvedTenant } from '../tenant/tenant-resolver';
import type { AuthSession, Role } from './session-authenticator';

export const PUBLIC_ROUTE = 'remix:public';
export const REQUIRED_ROLES = 'remix:roles';

export interface PublicOptions {
  /**
   * Look up the session anyway and expose it if present (e.g. logout, which is a no-op without
   * a session). Off by default so public pages cost no session lookup.
   */
  optionalSession?: boolean;
}

/** Route needs no session. Every route without it requires one (deny by default). */
export const Public = (options: PublicOptions = {}): MethodDecorator & ClassDecorator =>
  SetMetadata(PUBLIC_ROUTE, options);

/** Route needs a session holding at least one of `roles` (403 otherwise). */
export const Roles = (...roles: [Role, ...Role[]]): MethodDecorator & ClassDecorator =>
  SetMetadata(REQUIRED_ROLES, roles);

export const REQUIRED_PERMISSIONS = 'remix:permissions';

/**
 * Route needs a staff session whose roles grant ALL of these permissions (`can()` from
 * `@remix/types`, the same table the admin UI uses to hide controls). Deny by default: students
 * and platform sessions are always refused with 403 `FORBIDDEN`. Resource scope (a teacher sees
 * only their classes) is applied in the service, not here.
 */
export const RequirePermission = (
  ...permissions: [Permission, ...Permission[]]
): MethodDecorator & ClassDecorator => SetMetadata(REQUIRED_PERMISSIONS, permissions);

export const REQUIRED_KINDS = 'remix:kinds';

/**
 * Route needs a session of one of these kinds (403 `FORBIDDEN` otherwise), e.g. student-only
 * portal endpoints that staff must not call.
 */
export const SessionKinds = (
  ...kinds: [AuthSession['kind'], ...AuthSession['kind'][]]
): MethodDecorator & ClassDecorator => SetMetadata(REQUIRED_KINDS, kinds);

/** The authenticated session (null only on `@Public({ optionalSession: true })` routes). */
export const CurrentSession = createParamDecorator(
  (_: unknown, context: ExecutionContext): AuthSession | null =>
    contextOf(context.switchToHttp().getRequest<Request>())?.session ?? null,
);

/** The tenant that owns the request host (tenant-scoped routes only). */
export const CurrentTenant = createParamDecorator(
  (_: unknown, context: ExecutionContext): ResolvedTenant => {
    const tenant = contextOf(context.switchToHttp().getRequest<Request>())?.tenant;
    if (!tenant) throw new Error('@CurrentTenant() used on a route that is not tenant-scoped');
    return tenant;
  },
);
