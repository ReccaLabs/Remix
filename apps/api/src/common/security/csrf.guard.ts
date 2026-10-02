import { type CanActivate, type ExecutionContext, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { contextOf } from '../context/request-context';
import { AppException } from '../errors/app-exception';
import { checkCsrf } from './csrf';

const SKIP_CSRF = 'remix:skipCsrf';

/**
 * Opt a route out of the CSRF guard. Only for provider webhooks (`/api/v1/webhooks/*`), which
 * never read the session cookie and are authenticated by signature instead (ADR 0003).
 */
export const SkipCsrf = (): MethodDecorator & ClassDecorator => SetMetadata(SKIP_CSRF, true);

/** Global guard enforcing {@link checkCsrf} on every state-changing request, before auth. */
@Injectable()
export class CsrfGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    if (context.getType() !== 'http') return true;
    const skip = this.reflector.getAllAndOverride<boolean | undefined>(SKIP_CSRF, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (skip) return true;

    const req = context.switchToHttp().getRequest<Request>();
    const verdict = checkCsrf({
      method: req.method,
      headers: req.headers,
      ownOrigin: contextOf(req)?.origin ?? null,
    });
    if (verdict.ok) return true;
    throw verdict.status === 415
      ? new AppException('CSRF_REJECTED', 415, 'Requests that change data must be sent as JSON')
      : new AppException('CSRF_REJECTED', 403, 'Cross-site request rejected');
  }
}
