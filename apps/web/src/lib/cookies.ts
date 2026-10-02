/**
 * ReMix auth cookies (ADR 0004): `__Host-` prefixed in production, plain names over http in dev.
 * These are the only cookies the web server forwards to the API (ADR 0006).
 */
export const AUTH_COOKIE_NAMES: ReadonlySet<string> = new Set([
  '__Host-remix_session',
  '__Host-remix_device',
  'remix_session',
  'remix_device',
]);

/**
 * Keep only the ReMix auth cookies from a `Cookie` header, in their original order and
 * encoding. Returns `null` when none are present.
 */
export function pickAuthCookies(cookieHeader: string | null | undefined): string | null {
  if (!cookieHeader) return null;
  const kept = cookieHeader
    .split(';')
    .map((pair) => pair.trim())
    .filter((pair) => {
      const eq = pair.indexOf('=');
      return eq > 0 && AUTH_COOKIE_NAMES.has(pair.slice(0, eq).trim());
    });
  return kept.length > 0 ? kept.join('; ') : null;
}
