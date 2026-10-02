import { RESERVED_SLUGS } from '@remix/types/api';

/**
 * Host → area classification (TEN-01). Pure, so `proxy.ts` and the tests share one source of
 * truth. The proxy only decides *which area* a host belongs to; whether a tenant host really
 * belongs to an institute is the API's decision (`GET /api/v1/tenant`, ADR 0003 / 0005).
 */

export interface HostConfig {
  /** Hosts whose single-label sub-domains are institute slugs: `remix.lk` (prod), `localhost` (dev). */
  tenantBaseDomains: readonly string[];
  /** Exact hosts of the platform admin: `admin.remix.lk` (prod), `admin.localhost` (dev). */
  platformHosts: readonly string[];
}

export type HostArea =
  { area: 'platform' } | { area: 'tenant'; host: string } | { area: 'unknown' };

const LABEL = /^(?!-)[a-z0-9-]{1,63}(?<!-)$/;
const IPV4 = /^\d{1,3}(?:\.\d{1,3}){3}$/;

/**
 * Lower-case, strip the port and one trailing dot, and reject anything that is not a plain DNS
 * name (IP literals, userinfo, paths, spaces, empty labels, over-long names). Returns `null` for
 * anything malformed so callers fail closed.
 */
export function normalizeHost(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let host = raw.trim().toLowerCase();
  if (host.length === 0 || host.length > 260) return null;

  // Bracketed IPv6 literal (`[::1]:3001`) — never a tenant or platform host.
  if (host.startsWith('[')) return null;

  const colon = host.indexOf(':');
  if (colon !== -1) {
    const port = host.slice(colon + 1);
    if (!/^\d{1,5}$/.test(port)) return null; // also rejects bare IPv6 (`::1`)
    host = host.slice(0, colon);
  }
  if (host.endsWith('.')) host = host.slice(0, -1);

  if (host.length === 0 || host.length > 253) return null;
  if (IPV4.test(host)) return null;
  const labels = host.split('.');
  if (!labels.every((label) => LABEL.test(label))) return null;
  // A numeric top-level label is never a real DNS name (also catches partial IPs like `10.1`).
  if (/^\d+$/.test(labels[labels.length - 1] ?? '')) return null;
  return host;
}

/** Normalise configured hosts the same way as request hosts; drops invalid entries. */
export function normalizeHostList(hosts: readonly string[]): string[] {
  return hosts.map((h) => normalizeHost(h)).filter((h): h is string => h !== null);
}

export function classifyHost(rawHost: string | null | undefined, config: HostConfig): HostArea {
  const host = normalizeHost(rawHost);
  if (!host) return { area: 'unknown' };

  if (config.platformHosts.includes(host)) return { area: 'platform' };

  // The most specific base domain wins (`staging.remix.lk` before `remix.lk`).
  const base = config.tenantBaseDomains
    .filter((b) => host === b || host.endsWith(`.${b}`))
    .sort((a, b) => b.length - a.length)[0];
  if (base !== undefined) {
    // The bare base domain is the marketing site (remix.lk) or nothing (localhost).
    if (host === base) return { area: 'unknown' };
    const sub = host.slice(0, -(base.length + 1));
    // Exactly one label under the base domain, and not a reserved name (www, api, admin…).
    if (sub.includes('.') || RESERVED_SLUGS.has(sub)) return { area: 'unknown' };
    return { area: 'tenant', host };
  }

  // Any other multi-label name may be a verified custom domain; the API decides. Single-label
  // names (`intranet`) can't be one.
  if (!host.includes('.')) return { area: 'unknown' };
  return { area: 'tenant', host };
}
