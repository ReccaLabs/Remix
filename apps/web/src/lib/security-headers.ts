/**
 * Security headers for every HTML/RSC response (DEVELOPMENT.md §5.3). Built per request in
 * `proxy.ts` because the CSP carries a fresh nonce; Next.js reads the nonce back from the
 * request's `Content-Security-Policy` header and stamps it on its own scripts.
 */

export interface CspOptions {
  nonce: string;
  /** `next dev` only: React needs `eval` for its dev tooling and dev CSS is injected inline. */
  isDev: boolean;
}

/** 128-bit random nonce, base64. Unpredictable and unique per request. */
export function createNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return btoa(String.fromCharCode(...bytes));
}

export function buildCsp({ nonce, isDev }: CspOptions): string {
  const n = `'nonce-${nonce}'`;
  const directives: Record<string, string[]> = {
    'default-src': ["'self'"],
    // 'strict-dynamic': only nonce'd scripts (Next's runtime + chunks) and what they load run.
    'script-src': ["'self'", n, "'strict-dynamic'", ...(isDev ? ["'unsafe-eval'"] : [])],
    // <style>/<link> elements need the nonce (or same origin). Dev injects CSS without a nonce.
    'style-src': isDev ? ["'self'", "'unsafe-inline'"] : ["'self'", n],
    // style="" attributes: React `style` props (Logo geometry, tenant brand variables on <html>).
    // They cannot run script or use selectors; url() loads are still bounded by img-src/font-src.
    'style-src-attr': ["'unsafe-inline'"],
    'img-src': ["'self'", 'data:', 'blob:'],
    'font-src': ["'self'"],
    'connect-src': ["'self'"],
    'media-src': ["'self'"],
    'object-src': ["'none'"],
    'base-uri': ["'none'"],
    'frame-ancestors': ["'none'"],
    'form-action': ["'self'"],
  };
  const policy = Object.entries(directives).map(([name, values]) => `${name} ${values.join(' ')}`);
  if (!isDev) policy.push('upgrade-insecure-requests');
  return policy.join('; ');
}

export interface SecurityHeaderOptions extends CspOptions {
  /** Send HSTS — production only (browsers ignore it over plain http anyway). */
  hsts: boolean;
}

export function securityHeaders(opts: SecurityHeaderOptions): Record<string, string> {
  return {
    'Content-Security-Policy': buildCsp(opts),
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy':
      'accelerometer=(), browsing-topics=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=()',
    'Cross-Origin-Opener-Policy': 'same-origin',
    // Legacy twin of frame-ancestors 'none' for old browsers.
    'X-Frame-Options': 'DENY',
    // No includeSubDomains/preload: tenant custom domains are the institute's own zone, and HSTS
    // on their apex must not force HTTPS onto their other sub-domains. remix.lk preload lives
    // at the edge (Cloudflare) instead.
    ...(opts.hsts ? { 'Strict-Transport-Security': 'max-age=31536000' } : {}),
  };
}
