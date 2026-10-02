import { type CanActivate, type ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request, Response } from 'express';
import { contextOf, type RequestContext } from '../context/request-context';
import { AppException } from '../errors/app-exception';
import { PUBLIC_ROUTE, REQUIRED_ROLES, type PublicOptions } from './auth.decorators';
import {
  SESSION_AUTHENTICATOR,
  type AuthSession,
  type Role,
  type SessionAuthenticator,
} from './session-authenticator';

/**
 * Global guard, deny by default: a route without `@Public()` requires a session (401
 * `UNAUTHENTICATED` otherwise). Runs after the tenant guard, so it can insist that the session
 * belongs to this host — a tenant-A cookie on tenant B's host, or a tenant cookie on the admin
 * host, is treated as no session at all.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(SESSION_AUTHENTICATOR) private readonly authenticator: SessionAuthenticator,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;
    const targets = [context.getHandler(), context.getClass()];
    const publicOptions = this.reflector.getAllAndOverride<PublicOptions | undefined>(
      PUBLIC_ROUTE,
      targets,
    );
    const roles = this.reflector.getAllAndOverride<Role[] | undefined>(REQUIRED_ROLES, targets);
    const needsLookup = !publicOptions || publicOptions.optionalSession === true || !!roles?.length;
    if (!needsLookup) return true;

    const http = context.switchToHttp();
    const req = http.getRequest<Request>();
    const ctx = contextOf(req);
    if (!ctx) throw new Error('Request context missing — is the context middleware installed?');

    const session = await this.authenticator.authenticate({
      req,
      res: http.getResponse<Response>(),
      tenant: ctx.tenant,
    });
    ctx.session = session && belongsToHost(session, ctx) ? session : null;

    if (!ctx.session && !publicOptions) throw new AppException('UNAUTHENTICATED', 401);
    return true;
  }
}

/** A session is only valid on the kind of host — and the tenant — it was issued for. */
export function belongsToHost(session: AuthSession, ctx: RequestContext): boolean {
  if (ctx.area === 'tenant') {
    return session.kind !== 'platform' && ctx.tenant !== null && session.tenantId === ctx.tenant.id;
  }
  if (ctx.area === 'platform') return session.kind === 'platform' && session.tenantId === null;
  return false;
}
