import { sql } from 'drizzle-orm';
import { boolean, check, index, pgTable, text, unique, uniqueIndex } from 'drizzle-orm/pg-core';
import { id, instant, tenantId, timestamps } from './columns';
import { appLocale, planId, tenantStatus } from './enums';

/**
 * The tenant root (an institute or a tutor). It has no `tenant_id`: its own `id` is the tenant id.
 * The app role may read only its own row (RLS); host → tenant resolution goes through
 * SECURITY DEFINER functions that return public fields only (migrations/0002).
 */
export const tenants = pgTable(
  'tenants',
  {
    id: id(),
    slug: text('slug').notNull(),
    name: text('name').notNull(),
    status: tenantStatus('status').notNull().default('trial'),
    plan: planId('plan').notNull(),
    defaultLocale: appLocale('default_locale').notNull().default('en'),
    timezone: text('timezone').notNull().default('Asia/Colombo'),
    /** Student numbers are `<prefix>-<zero-padded counter>`, e.g. "BR-1042" (TEN-02, ADR 0007). */
    studentNoPrefix: text('student_no_prefix').notNull(),
    brandColor: text('brand_color'),
    logoUrl: text('logo_url'),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex('tenants_slug_key').on(t.slug),
    // Mirrors tenantSlugSchema (@remix/types) so a row can never hold a slug the API would reject.
    check(
      'tenants_slug_format',
      sql`${t.slug} ~ '^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$' AND position('--' in ${t.slug}) = 0`,
    ),
    check('tenants_name_length', sql`char_length(${t.name}) BETWEEN 2 AND 120`),
    // ADR 0007: only Asia/Colombo until another zone has been tested end to end.
    check('tenants_timezone_supported', sql`${t.timezone} = 'Asia/Colombo'`),
    check('tenants_student_no_prefix_format', sql`${t.studentNoPrefix} ~ '^[A-Z]{1,6}$'`),
    check('tenants_brand_color_format', sql`${t.brandColor} ~ '^#[0-9a-fA-F]{6}$'`),
    check('tenants_logo_url_https', sql`${t.logoUrl} ~ '^https://'`),
  ],
);

/**
 * Custom hostnames (e.g. `classes.kamalphysics.lk`). A host resolves to its tenant only once
 * `verified_at` is set. Sub-domains of the base domains (`<slug>.remix.lk`) are not stored here.
 */
export const tenantDomains = pgTable(
  'tenant_domains',
  {
    id: id(),
    tenantId: tenantId().references(() => tenants.id, { onDelete: 'cascade' }),
    host: text('host').notNull(),
    verifiedAt: instant('verified_at'),
    isPrimary: boolean('is_primary').notNull().default(false),
    ...timestamps(),
  },
  (t) => [
    unique('tenant_domains_tenant_id_id_key').on(t.tenantId, t.id),
    // Deliberately global (allow-listed in the catalog check): one host belongs to one tenant.
    // The app role cannot write this table, so the constraint error is never visible to it.
    uniqueIndex('tenant_domains_host_key').on(t.host),
    index('tenant_domains_tenant_idx').on(t.tenantId),
    uniqueIndex('tenant_domains_one_primary')
      .on(t.tenantId)
      .where(sql`${t.isPrimary}`),
    // Stored normalised (lower-case, no port, no trailing dot) — see normaliseHost().
    check(
      'tenant_domains_host_format',
      sql`${t.host} ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?([.][a-z0-9]([a-z0-9-]*[a-z0-9])?)+$' AND char_length(${t.host}) <= 253`,
    ),
  ],
);
