/**
 * Post-login redirect targets (`/login?next=/app/classes`). The value comes from the address
 * bar, so it is attacker-controlled: only a path on this same host is ever honoured, never an
 * absolute or protocol-relative URL (open redirect, DEVELOPMENT.md §5.3).
 */

/** Query parameter that carries the page to return to after login. */
export const NEXT_PARAM = 'next';

const MAX_LENGTH = 2048;
const BASE = 'http://same-origin.invalid';

/**
 * Returns a normalised same-host path (`/app/classes?tab=1`), or `null` if `raw` is anything
 * else. Rejects:
 * - anything not starting with exactly one `/` (`//evil`, `https://evil`, `evil`, `javascript:`);
 * - backslashes anywhere (`/\evil` — browsers treat `\` as `/`);
 * - control characters and spaces (browsers strip tab/CR/LF, turning `/\t/evil` into `//evil`);
 * - with `within`, paths outside that section after normalisation (`/app/../admin`).
 */
export function safeNextPath(raw: unknown, within?: string): string | null {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > MAX_LENGTH) return null;
  if (raw[0] !== '/' || raw[1] === '/' || raw.includes('\\')) return null;
  // Control characters, space and DEL.
  if (/[\u0000- \u007f]/.test(raw)) return null;

  let url: URL;
  try {
    url = new URL(raw, BASE);
  } catch {
    return null;
  }
  if (url.origin !== BASE) return null;

  const path = url.pathname;
  if (within && path !== within && !path.startsWith(`${within}/`)) return null;
  return `${path}${url.search}${url.hash}`;
}

/** `/login?next=…` for a guard redirect; plain `loginPath` when `from` isn't a safe path. */
export function loginRedirect(loginPath: string, from: string | null, within?: string): string {
  const next = from ? safeNextPath(from, within) : null;
  // The section home is where login goes anyway; keep the URL short.
  if (!next || next === within) return loginPath;
  return `${loginPath}?${new URLSearchParams({ [NEXT_PARAM]: next }).toString()}`;
}
