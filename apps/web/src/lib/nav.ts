import { AREA_PREFIX } from './routing';

/**
 * Whether a nav item is the current section. `exact` items (the section home) match only
 * themselves; others also match their sub-pages (`/app/classes/…`). The internal area prefix
 * is stripped defensively, in case a server render reports the rewritten path.
 */
export function isActivePath(pathname: string | null, href: string, exact = false): boolean {
  if (!pathname) return false;
  let path = pathname.replace(/\/+$/, '') || '/';
  const prefix = AREA_PREFIX.tenant;
  if (path === prefix || path.startsWith(`${prefix}/`)) path = path.slice(prefix.length) || '/';
  if (exact) return path === href;
  return path === href || path.startsWith(`${href}/`);
}
