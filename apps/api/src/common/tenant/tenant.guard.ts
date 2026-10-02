import {
  type CanActivate,
  type ExecutionContext,
  Inject,
  Injectable,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { APP_CONFIG, type AppConfig } from '../../config/config';
import { contextOf } from '../context/request-context';
import { AppException } from '../errors/app-exception';
import { TENANT_RESOLVER, type TenantResolver } from './tenant-resolver';

/**
 * Which kind of host a route is served on (ADR 0003):
 * - `tenant` (default): an institute host; the tenant is resolved, unknown host → 404.
 * - `platform`: only on `PLATFORM_HOSTS` (admin area), no tenant.
 * - `any`: host-independent infrastructure (health checks). No tenant, no session.
 */
export type HostScope = 'tenant' | 'platform' | 'any';

const HOST_SCOPE = 'remix:hostScope';

export const HostScope = (scope: HostScope): MethodDecorator & ClassDecorator =>
  SetMetadata(HOST_SCOPE, scope);

/** Global guard: resolves the request host to a tenant (or the platform area) per route scope. */
@Injectable()
export class TenantGuard implements CanActivate {
  private readonly platformHosts: ReadonlySet<string>;

  constructor(
    private readonly reflector: Reflector,
    @Inject(TENANT_RESOLVER) private readonly resolver: TenantResolver,
    @Inject(APP_CONFIG) config: AppConfig,
  ) {
    this.platformHosts = new Set(config.platformHosts);
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;
    const scope =
      this.reflector.getAllAndOverride<HostScope | undefined>(HOST_SCOPE, [
        context.getHandler(),
        context.getClass(),
      ]) ?? 'tenant';
    if (scope === 'any') return true;

    const ctx = contextOf(context.switchToHttp().getRequest<Request>());
    if (!ctx) throw new Error('Request context missing — is the context middleware installed?');
    const isPlatformHost = ctx.host !== null && this.platformHosts.has(ctx.host);

    if (scope === 'platform' || isPlatformHost) {
      // A route on the wrong kind of host does not exist there.
      if (scope !== 'platform' || !isPlatformHost) throw new AppException('NOT_FOUND', 404);
      ctx.area = 'platform';
      return true;
    }

    const tenant = ctx.host ? await this.resolver.resolve(ctx.host) : null;
    if (!tenant) throw new AppException('TENANT_NOT_FOUND', 404, 'Institute not found');
    ctx.area = 'tenant';
    ctx.tenant = tenant;
    return true;
  }
}
