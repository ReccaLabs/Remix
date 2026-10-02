import type { HostArea } from './host';

/**
 * Each area lives under a real internal URL segment (`src/app/tenant/…`, `src/app/platform/…`)
 * because route groups can't share URL paths. The proxy rewrites every external path into the
 * area's prefix, so the browser never sees these prefixes and can never address them directly.
 */
export const AREA_PREFIX = { tenant: '/tenant', platform: '/platform' } as const;
export type Area = keyof typeof AREA_PREFIX;

/**
 * Rewrite target for requests that must 404. No route can match it: App Router ignores
 * folders starting with `_`, so this path always falls through to `app/not-found.tsx`.
 */
export const NOT_FOUND_PATH = '/__remix_not_found';

export type RouteDecision =
  { action: 'rewrite'; area: Area; pathname: string } | { action: 'not-found' };

/** True for `/tenant`, `/tenant/…`, `/platform`, `/platform/…` (any case). */
export function isInternalPath(pathname: string): boolean {
  const lower = pathname.toLowerCase();
  return Object.values(AREA_PREFIX).some(
    (prefix) => lower === prefix || lower.startsWith(`${prefix}/`),
  );
}

/** Decide what the proxy does with a request, given its path and classified host. */
export function decideRoute(pathname: string, host: HostArea): RouteDecision {
  if (isInternalPath(pathname) || host.area === 'unknown') return { action: 'not-found' };

  const prefix = AREA_PREFIX[host.area];
  return {
    action: 'rewrite',
    area: host.area,
    pathname: pathname === '/' ? prefix : `${prefix}${pathname}`,
  };
}
