import type { TenantStatus } from '@remix/types/api';

/** The institute that owns the request host — the minimum every request needs. */
export interface ResolvedTenant {
  id: string;
  slug: string;
  status: TenantStatus;
}

/**
 * Host → tenant lookup. Track E implements it with `resolveTenantByHost` from `@remix/db`
 * (SECURITY DEFINER function + Valkey cache, key `host:<host>`, 60 s). Must return null — never
 * throw — for unknown or unverified hosts; infrastructure failures may throw (→ 500).
 */
export interface TenantResolver {
  resolve(host: string): Promise<ResolvedTenant | null>;
}

/** DI token for {@link TenantResolver}. */
export const TENANT_RESOLVER = Symbol('TenantResolver');

/** Default until the database lands: no host belongs to a tenant (tenant routes answer 404). */
export class NullTenantResolver implements TenantResolver {
  resolve(): Promise<ResolvedTenant | null> {
    return Promise.resolve(null);
  }
}
