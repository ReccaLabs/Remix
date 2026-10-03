import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { can, type Permission } from '@remix/types';
import type { Request } from 'express';
import { contextOf } from '../context/request-context';
import { AppException } from '../errors/app-exception';
import { REQUIRED_PERMISSIONS } from './auth.decorators';

/**
 * Global guard for `@RequirePermission(...)`: the session must be a staff session whose roles
 * grant every listed permission (STF-01/02). Anything else — a student, a platform session, a
 * staff member with a weaker role — gets 403 `FORBIDDEN`. The route's own handler is never
 * reached, so there is nothing to forget in a controller.
 */
@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    if (context.getType() !== 'http') return true;
    const required = this.reflector.getAllAndOverride<Permission[] | undefined>(
      REQUIRED_PERMISSIONS,
      [context.getHandler(), context.getClass()],
    );
    if (!required?.length) return true;

    const session = contextOf(context.switchToHttp().getRequest<Request>())?.session;
    if (!session) throw new AppException('UNAUTHENTICATED', 401);
    if (session.kind !== 'staff' || !required.every((p) => can(session.roles, p))) {
      throw new AppException('FORBIDDEN', 403);
    }
    return true;
  }
}
