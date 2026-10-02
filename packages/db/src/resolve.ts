import { sql } from 'drizzle-orm';
import { tenantPublicSchema, type TenantPublic } from '@remix/types';
import type { Queryable } from './client';
import { classifyHost } from './host';

/** Minimal cache port (Valkey in the API) so this package does not depend on a cache client. */
export interface TenantCache {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSeconds: number): Promise<void>;
}

export interface ResolveTenantOptions {
  /** Platform base domains, e.g. `['remix.lk']` (prod) or `['localhost']` (dev). */
  baseDomains: readonly string[];
  /** Optional cache of positive results, key `host:<host>`, 60 s (ADR 0005). */
  cache?: TenantCache;
}

export const TENANT_CACHE_TTL_SECONDS = 60;

interface TenantRow extends Record<string, unknown> {
  id: string;
  slug: string;
  name: string;
  status: string;
  plan: string;
  default_locale: string;
  timezone: string;
  brand_color: string | null;
  logo_url: string | null;
}

/**
 * Host → tenant (TEN-01). Returns the public tenant record, or null for an unknown host, a
 * reserved or malformed name, or an unverified custom domain. Suspended and cancelled tenants
 * resolve too — callers decide what their status allows (`tenantAccess`).
 *
 * Works on the `remix_app` pool without a tenant context: the lookup goes through SECURITY
 * DEFINER functions that expose only `tenantPublicSchema` fields.
 */
export async function resolveTenantByHost(
  db: Queryable,
  host: string,
  options: ResolveTenantOptions,
): Promise<TenantPublic | null> {
  const target = classifyHost(host, options.baseDomains);
  if (target === null) return null;

  const cacheKey = `host:${target.host}`;
  const cached = await readCache(options.cache, cacheKey);
  if (cached) return cached;

  const query =
    target.kind === 'slug'
      ? sql`select * from public.resolve_tenant_by_slug(${target.slug})`
      : sql`select * from public.resolve_tenant_by_domain(${target.host})`;
  const { rows } = await db.execute<TenantRow>(query);
  const row = rows[0];
  if (row === undefined) return null;

  const tenant = tenantPublicSchema.parse({
    id: row.id,
    slug: row.slug,
    name: row.name,
    status: row.status,
    plan: row.plan,
    defaultLocale: row.default_locale,
    timezone: row.timezone,
    brandColor: row.brand_color,
    logoUrl: row.logo_url,
  });
  await options.cache?.set(cacheKey, JSON.stringify(tenant), TENANT_CACHE_TTL_SECONDS);
  return tenant;
}

/** A cache entry is re-validated, so a poisoned or stale-shaped value is ignored, not trusted. */
async function readCache(
  cache: TenantCache | undefined,
  key: string,
): Promise<TenantPublic | null> {
  const raw = await cache?.get(key);
  if (!raw) return null;
  try {
    const parsed = tenantPublicSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
