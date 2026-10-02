import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { contextOf } from '../context/request-context';
import { AppException } from '../errors/app-exception';
import { REQUIRED_ROLES } from './auth.decorators';
import type { Role } from './session-authenticator';

/**
 * Global guard for `@Roles(...)`: the session must hold at least one of the listed roles.
 * Resource scope (a teacher sees only their own classes) is checked in the service and again by
 * RLS — this guard only answers "may this kind of user call this endpoint at all".
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    if (context.getType() !== 'http') return true;
    const roles = this.reflector.getAllAndOverride<Role[] | undefined>(REQUIRED_ROLES, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!roles?.length) return true;

    const session = contextOf(context.switchToHttp().getRequest<Request>())?.session;
    if (!session) throw new AppException('UNAUTHENTICATED', 401);
    if (!roles.some((role) => session.roles.includes(role))) {
      throw new AppException('FORBIDDEN', 403);
    }
    return true;
  }
}
