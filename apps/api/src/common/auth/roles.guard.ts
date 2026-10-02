import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { contextOf } from '../context/request-context';
import { AppException } from '../errors/app-exception';
import { REQUIRED_KINDS, REQUIRED_ROLES } from './auth.decorators';
import type { AuthSession, Role } from './session-authenticator';

/**
 * Global guard for `@Roles(...)` and `@SessionKinds(...)`: the session must be of one of the
 * listed kinds and hold at least one of the listed roles. Resource scope (a teacher sees only
 * their own classes) is checked in the service and again by RLS — this guard only answers "may
 * this kind of user call this endpoint at all".
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    if (context.getType() !== 'http') return true;
    const targets = [context.getHandler(), context.getClass()];
    const roles = this.reflector.getAllAndOverride<Role[] | undefined>(REQUIRED_ROLES, targets);
    const kinds = this.reflector.getAllAndOverride<AuthSession['kind'][] | undefined>(
      REQUIRED_KINDS,
      targets,
    );
    if (!roles?.length && !kinds?.length) return true;

    const session = contextOf(context.switchToHttp().getRequest<Request>())?.session;
    if (!session) throw new AppException('UNAUTHENTICATED', 401);
    if (kinds?.length && !kinds.includes(session.kind)) throw new AppException('FORBIDDEN', 403);
    if (roles?.length && !roles.some((role) => session.roles.includes(role))) {
      throw new AppException('FORBIDDEN', 403);
    }
    return true;
  }
}
