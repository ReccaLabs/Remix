import { tenantSlugSchema } from '@remix/types';

/** One DNS label: letters, digits, inner hyphens, 1–63 chars (IDN hosts arrive as punycode). */
const LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const PORT_SUFFIX = /^(.+):(\d{1,5})$/;
/** 253-char name + `:65535` + a little whitespace; anything longer is rejected before parsing. */
const MAX_RAW_LENGTH = 270;

/**
 * Normalise a `Host` header value: trim, lower-case, strip a `:port` and one trailing dot.
 * Returns null for anything that is not a plain DNS name — IP literals, userinfo, paths,
 * empty labels, over-long names. The result is what `tenant_domains.host` stores.
 */
export function normaliseHost(raw: string): string | null {
  if (raw.length > MAX_RAW_LENGTH) return null;
  let host = raw.trim().toLowerCase();
  const port = PORT_SUFFIX.exec(host);
  if (port) {
    if (Number(port[2]) > 65_535) return null;
    host = port[1] ?? '';
  }
  if (host.endsWith('.')) host = host.slice(0, -1);
  if (host.length === 0 || host.length > 253) return null;

  const labels = host.split('.');
  if (!labels.every((label) => LABEL.test(label))) return null;
  // An all-numeric last label is an IPv4 literal or nonsense, never a tenant host.
  if (/^\d+$/.test(labels[labels.length - 1] ?? '')) return null;
  return host;
}

/** `host` is always the normalised host (the cache key and the `tenant_domains.host` value). */
export type HostTarget =
  /** `<slug>.<baseDomain>` — look the tenant up by slug. */
  | { kind: 'slug'; slug: string; host: string }
  /** Any other well-formed host — look it up among verified custom domains. */
  | { kind: 'domain'; host: string };

/**
 * Decide how a host maps to a tenant (TEN-01). `baseDomains` are the platform's own domains
 * (`remix.lk` in prod, `localhost` in dev); the longest matching one wins.
 *
 * - `kamalphysics.remix.lk` → slug `kamalphysics` (must pass `tenantSlugSchema`, so reserved
 *   names like `admin` or `www` never resolve to a tenant).
 * - The base domain itself, or a deeper sub-domain (`a.b.remix.lk`) → null: we control that DNS
 *   and never hand it to a tenant.
 * - Anything else with at least one dot → custom-domain lookup.
 */
export function classifyHost(rawHost: string, baseDomains: readonly string[]): HostTarget | null {
  const host = normaliseHost(rawHost);
  if (host === null) return null;

  const bases = baseDomains
    .map((base) => {
      const normalised = normaliseHost(base);
      if (normalised === null) throw new TypeError(`Invalid base domain: ${base}`);
      return normalised;
    })
    .sort((a, b) => b.length - a.length);

  for (const base of bases) {
    if (host === base) return null;
    if (!host.endsWith(`.${base}`)) continue;
    const label = host.slice(0, -(base.length + 1));
    if (label.includes('.')) return null;
    const slug = tenantSlugSchema.safeParse(label);
    return slug.success && slug.data === label ? { kind: 'slug', slug: label, host } : null;
  }

  return host.includes('.') ? { kind: 'domain', host } : null;
}
