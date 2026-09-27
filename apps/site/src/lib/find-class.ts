/**
 * "Find your class": turn what a student types into their institute's ReMix address.
 *
 * SECURITY: this feeds a navigation, so it must never become an open redirect. The only URL it
 * can ever produce is `https://<slug>.remix.lk/`, where `slug` has passed the strict DNS-label
 * regex below. Anything else (other domains, paths, userinfo, ports, IDN) is rejected.
 */

export const CLASS_DOMAIN = 'remix.lk';

/** One DNS label: lowercase letters, digits and inner hyphens, 1 or 3–63 characters. */
const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])?$/;

/** Subdomains that belong to ReMix itself, never to an institute. */
export const RESERVED_SLUGS: ReadonlySet<string> = new Set([
  'www',
  'admin',
  'api',
  'app',
  'mail',
  'staging',
  'auth',
  'login',
  'sso',
  'dashboard',
  'billing',
  'pay',
  'payments',
  'status',
  'docs',
  'help',
  'support',
  'blog',
  'cdn',
  'static',
  'assets',
  'media',
  'files',
  'dev',
  'test',
  'preview',
  'demo',
  'security',
  'smtp',
  'imap',
  'pop',
  'webmail',
  'email',
  'ftp',
  'ns1',
  'ns2',
  'mx',
  'remix',
  'recca',
  'internal',
]);

export type FindClassResult =
  | { ok: true; slug: string; url: string }
  | { ok: false; reason: 'empty' | 'invalid' | 'reserved' | 'otherDomain' };

/**
 * Accepts `kamalphysics`, `kamalphysics.remix.lk`, `https://kamalphysics.remix.lk/login`…
 * and returns `https://kamalphysics.remix.lk/`. Paths, queries and fragments are dropped.
 */
export function parseClassAddress(input: string): FindClassResult {
  let host = input.trim().toLowerCase();
  if (!host) return { ok: false, reason: 'empty' };

  // Strip an optional scheme, then everything after the host.
  host = host.replace(/^[a-z][a-z0-9+.-]*:\/\//, '');
  host = host.split(/[/?#\\]/, 1)[0] ?? '';
  host = host.replace(/\.$/, '');

  // Userinfo (`evil.com@x`), ports and whitespace have no place in a class address.
  if (!host || /[@:\s]/.test(host)) return { ok: false, reason: 'invalid' };

  let slug: string;
  if (host === CLASS_DOMAIN || host === `www.${CLASS_DOMAIN}`) {
    return { ok: false, reason: 'reserved' };
  } else if (host.endsWith(`.${CLASS_DOMAIN}`)) {
    slug = host.slice(0, -(CLASS_DOMAIN.length + 1));
  } else if (host.includes('.')) {
    // Institutes on their own domain are reached directly, not through remix.lk.
    return { ok: false, reason: 'otherDomain' };
  } else {
    slug = host;
  }

  // Multi-level (`a.b.remix.lk`), punycode/IDN and anything outside the label grammar.
  if (!SLUG_RE.test(slug) || slug.startsWith('xn--')) return { ok: false, reason: 'invalid' };
  if (RESERVED_SLUGS.has(slug)) return { ok: false, reason: 'reserved' };

  return { ok: true, slug, url: `https://${slug}.${CLASS_DOMAIN}/` };
}
