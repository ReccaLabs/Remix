import { Inject, Injectable } from '@nestjs/common';
import { resolveTenantByHost, type Db, type TenantCache } from '@remix/db';
import type { TenantPublic } from '@remix/types/api';
import type { ResolvedTenant, TenantResolver } from '../../common/tenant/tenant-resolver';
import { APP_CONFIG, type AppConfig } from '../../config/config';
import { DB } from '../db/db.module';

/** DI token for the host → tenant cache ({@link TenantCache} from `@remix/db`). */
export const TENANT_CACHE = Symbol('TenantCache');

/**
 * `TENANT_RESOLVER` backed by the database (TEN-01): `resolveTenantByHost` with
 * `TENANT_BASE_DOMAINS`, through the SECURITY DEFINER resolver functions (the app role can't
 * read `tenants` without a tenant context), cached 60 s under `host:<host>`. Unknown,
 * unverified, reserved or malformed hosts resolve to null (→ 404 `TENANT_NOT_FOUND`); suspended
 * and cancelled tenants resolve with their status, and the access rules decide (TEN-06).
 */
@Injectable()
export class DbTenantResolver implements TenantResolver {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(TENANT_CACHE) private readonly cache: TenantCache,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async resolve(host: string): Promise<ResolvedTenant | null> {
    const tenant = await this.resolvePublic(host);
    return tenant ? { id: tenant.id, slug: tenant.slug, status: tenant.status } : null;
  }

  /** The full public record (GET /api/v1/tenant). */
  resolvePublic(host: string): Promise<TenantPublic | null> {
    return resolveTenantByHost(this.db, host, {
      baseDomains: this.config.tenantBaseDomains,
      cache: this.cache,
    });
  }
}
