import { z } from 'zod';
import { PLAN_IDS } from '../pricing';

export const TENANT_STATUSES = ['trial', 'active', 'past_due', 'suspended', 'cancelled'] as const;
export type TenantStatus = (typeof TENANT_STATUSES)[number];

export const LOCALES = ['en', 'si', 'ta'] as const;
export type AppLocale = (typeof LOCALES)[number];

/**
 * Sub-domains that can never be an institute slug (platform hosts, infrastructure, look-alikes).
 */
export const RESERVED_SLUGS: ReadonlySet<string> = new Set([
  'admin',
  'api',
  'app',
  'assets',
  'cdn',
  'docs',
  'domains',
  'help',
  'mail',
  'platform',
  'remix',
  'staging',
  'static',
  'status',
  'support',
  'www',
]);

/** Institute slug: lowercase letters, digits and inner hyphens, 3–40 chars, not reserved. */
export const tenantSlugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9](?:[a-z0-9-]{1,38})[a-z0-9]$/, 'Use 3–40 lowercase letters, digits or hyphens')
  .refine((s) => !s.includes('--'), 'No double hyphens')
  .refine((s) => !RESERVED_SLUGS.has(s), 'This name is reserved');

/** `#rrggbb` only — validated before it is ever written into a CSS variable. */
export const brandColorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/);

/** What any visitor of a tenant host may know about the institute (GET /api/v1/tenant). */
export const tenantPublicSchema = z.object({
  id: z.uuid(),
  slug: z.string(),
  name: z.string(),
  status: z.enum(TENANT_STATUSES),
  plan: z.enum(PLAN_IDS),
  defaultLocale: z.enum(LOCALES),
  timezone: z.string(),
  brandColor: brandColorSchema.nullable(),
  logoUrl: z.url().nullable(),
  /** TEN-03 (Phase 2). */
  faviconUrl: z.url().nullable().default(null),
});
export type TenantPublic = z.infer<typeof tenantPublicSchema>;

export interface TenantAccess {
  /** Public institute website renders normally (otherwise a neutral "temporarily unavailable"). */
  publicSite: boolean;
  /** Students may sign in and use the portal. */
  studentPortal: boolean;
  /** Institute staff: everything, billing pages only, or nothing. */
  staff: 'full' | 'billing-only' | 'none';
}

/**
 * TEN-06 — what a tenant's status allows. The API enforces this; the web app uses it only to
 * choose which screen to show.
 */
export function tenantAccess(status: TenantStatus): TenantAccess {
  switch (status) {
    case 'trial':
    case 'active':
    case 'past_due':
      return { publicSite: true, studentPortal: true, staff: 'full' };
    case 'suspended':
      return { publicSite: false, studentPortal: false, staff: 'billing-only' };
    case 'cancelled':
      return { publicSite: false, studentPortal: false, staff: 'none' };
  }
}
