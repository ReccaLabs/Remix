/**
 * Session rotation from the proxy (ADR 0004). Server Components can't set cookies, so the proxy
 * — which can — asks the API to rotate a session token once it is 15 minutes old, relays the new
 * cookie to the browser and hands it to this render. Pure helpers here; the proxy wires them up.
 */

/** Rotate once the token is this old. The API applies the same threshold (no-op below it). */
export const REFRESH_AFTER_SECONDS = 15 * 60;

/** A refresh must never hold up the page for long; on timeout the render carries on as is. */
export const REFRESH_TIMEOUT_MS = 3_000;

export const REFRESH_PATH = '/api/v1/auth/session/refresh';

/**
 * `__Host-remix_session` over HTTPS (production), `remix_session` over plain HTTP (dev) — the
 * same rule the API uses when it sets the cookie. Browsers only accept `__Host-` cookies that
 * are `Secure`, so exactly one of the two names can be live for a given scheme.
 */
export function sessionCookieName(secure: boolean): string {
  return secure ? '__Host-remix_session' : 'remix_session';
}

/** Value of cookie `name` in a `Cookie` header (first match), or `null`. */
export function readCookie(cookieHeader: string | null | undefined, name: string): string | null {
  if (!cookieHeader) return null;
  for (const pair of cookieHeader.split(';')) {
    const eq = pair.indexOf('=');
    if (eq > 0 && pair.slice(0, eq).trim() === name) return pair.slice(eq + 1).trim();
  }
  return null;
}

// `<unixSeconds>.<random>`: seconds as plain digits, then the base64url random part.
const TOKEN = /^(\d{1,12})\.[A-Za-z0-9_-]{16,}$/;

/**
 * Issue time (unix seconds) from a session token, or `null` when the value isn't shaped like a
 * token. It is only a hint for *when* to refresh: tampering with it changes the token's hash, so
 * the API rejects the token anyway.
 */
export function tokenIssuedAt(value: string | null | undefined): number | null {
  if (!value) return null;
  const match = TOKEN.exec(value);
  if (!match?.[1]) return null;
  const seconds = Number(match[1]);
  return Number.isSafeInteger(seconds) ? seconds : null;
}

/**
 * Next.js router prefetches (`next-router-prefetch`) and browser speculative loads
 * (`Purpose`/`Sec-Purpose: prefetch`). These must never rotate a session: the response may be
 * thrown away, taking the only copy of the new cookie with it.
 */
export function isPrefetch(headers: Headers): boolean {
  if (headers.has('next-router-prefetch') || headers.has('x-middleware-prefetch')) return true;
  const purpose = `${headers.get('purpose') ?? ''} ${headers.get('sec-purpose') ?? ''}`;
  return /\bprefetch\b/i.test(purpose);
}

export interface RefreshInput {
  /** Only tenant pages refresh; the platform area has its own sessions (AUTH-06). */
  area: 'tenant' | 'platform' | null;
  headers: Headers;
  secure: boolean;
  nowSeconds: number;
}

/** The cookie to refresh, or `null` when this request must not trigger a refresh. */
export function refreshCandidate(input: RefreshInput): { name: string; value: string } | null {
  if (input.area !== 'tenant' || isPrefetch(input.headers)) return null;
  const name = sessionCookieName(input.secure);
  const value = readCookie(input.headers.get('cookie'), name);
  const issuedAt = tokenIssuedAt(value);
  if (value === null || issuedAt === null) return null;
  // A token "from the future" (clock skew) is left alone; the API decides on its own clock.
  return input.nowSeconds - issuedAt >= REFRESH_AFTER_SECONDS ? { name, value } : null;
}

export interface SetCookieChange {
  name: string;
  /** `null` when the Set-Cookie deletes the cookie (expired or Max-Age ≤ 0). */
  value: string | null;
}

/** Name and value a `Set-Cookie` header gives the browser. `null` for a malformed header. */
export function parseSetCookie(header: string): SetCookieChange | null {
  const [pair = '', ...attrs] = header.split(';');
  const eq = pair.indexOf('=');
  if (eq <= 0) return null;
  const name = pair.slice(0, eq).trim();
  const value = pair.slice(eq + 1).trim();
  const deleted = attrs.some((attr) => {
    const [key = '', val = ''] = attr.split('=').map((s) => s.trim());
    if (key.toLowerCase() === 'max-age') return Number(val) <= 0;
    if (key.toLowerCase() === 'expires') return Date.parse(val) <= Date.now();
    return false;
  });
  return { name, value: deleted ? null : value };
}

/**
 * A `Cookie` request header with `changes` applied: replaced in place, appended when new,
 * removed when deleted. Other cookies keep their order. `null` when nothing is left.
 */
export function applyCookieChanges(
  cookieHeader: string | null | undefined,
  changes: readonly SetCookieChange[],
): string | null {
  const pairs = (cookieHeader ?? '')
    .split(';')
    .map((p) => p.trim())
    .filter(Boolean);
  for (const { name, value } of changes) {
    const index = pairs.findIndex((p) => p.slice(0, p.indexOf('=')).trim() === name);
    if (value === null) {
      if (index >= 0) pairs.splice(index, 1);
    } else if (index >= 0) {
      pairs[index] = `${name}=${value}`;
    } else {
      pairs.push(`${name}=${value}`);
    }
  }
  return pairs.length > 0 ? pairs.join('; ') : null;
}

/** `Set-Cookie` that removes the session cookie (same attributes the API sets it with). */
export function clearCookieHeader(name: string, secure: boolean): string {
  return `${name}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`;
}

export type RefreshOutcome =
  /** 200: the API's Set-Cookie headers (empty when it was a no-op inside the grace window). */
  | { kind: 'rotated'; setCookies: string[] }
  /** 401: the session is gone (expired, revoked, reused) — drop the cookie. */
  | { kind: 'expired' }
  /** Anything else (outage, timeout, 5xx): leave the request untouched. */
  | { kind: 'unchanged' };

/**
 * POST the refresh endpoint server-side. Never throws: a slow or broken API must not block the
 * page — the render then calls the API with the old cookie, which still works or 401s.
 */
export async function requestRefresh(opts: {
  apiUrl: string;
  headers: Headers;
  fetch?: typeof fetch;
  timeoutMs?: number;
}): Promise<RefreshOutcome> {
  const doFetch = opts.fetch ?? fetch;
  const headers = new Headers(opts.headers);
  headers.set('accept', 'application/json');
  // Every state-changing call is JSON, even bodyless ones (ADR 0003).
  headers.set('content-type', 'application/json');
  try {
    const res = await doFetch(`${opts.apiUrl}${REFRESH_PATH}`, {
      method: 'POST',
      headers,
      body: '{}',
      cache: 'no-store',
      redirect: 'manual',
      signal: AbortSignal.timeout(opts.timeoutMs ?? REFRESH_TIMEOUT_MS),
    });
    // The body is not needed; release the connection.
    await res.body?.cancel().catch(() => undefined);
    if (res.status === 200) return { kind: 'rotated', setCookies: res.headers.getSetCookie() };
    if (res.status === 401) return { kind: 'expired' };
    return { kind: 'unchanged' };
  } catch {
    return { kind: 'unchanged' };
  }
}
