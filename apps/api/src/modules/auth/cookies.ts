import type { IncomingHttpHeaders } from 'node:http';

/**
 * Auth cookie names (ADR 0004). With secure cookies (production) the `__Host-` prefix makes the
 * browser enforce host-only + Secure + `Path=/`, so a sibling sub-domain can't plant or shadow
 * them; plain names exist only for plain-HTTP dev. Only the configured variant is ever read.
 */
export interface CookieNames {
  session: string;
  device: string;
}

export const SECURE_COOKIE_NAMES: CookieNames = {
  session: '__Host-remix_session',
  device: '__Host-remix_device',
};
export const DEV_COOKIE_NAMES: CookieNames = { session: 'remix_session', device: 'remix_device' };

export function cookieNames(secure: boolean): CookieNames {
  return secure ? SECURE_COOKIE_NAMES : DEV_COOKIE_NAMES;
}

export interface CookieOptions {
  secure: boolean;
  /** Seconds; omitted → a browser-session cookie. 0 deletes the cookie. */
  maxAge?: number;
}

const COOKIE_VALUE = /^[A-Za-z0-9._-]*$/;

/**
 * `Set-Cookie` value for an auth cookie: host-only (never `Domain`), `Path=/`, `HttpOnly`,
 * `SameSite=Lax`, `Secure` when configured. Values are restricted to token characters.
 */
export function serializeCookie(name: string, value: string, options: CookieOptions): string {
  if (!COOKIE_VALUE.test(value)) throw new Error('Cookie value has unexpected characters');
  if (name.startsWith('__Host-') && !options.secure) {
    throw new Error('__Host- cookies must be Secure');
  }
  const parts = [`${name}=${value}`];
  if (options.maxAge !== undefined)
    parts.push(`Max-Age=${Math.max(0, Math.floor(options.maxAge))}`);
  parts.push('Path=/', 'HttpOnly');
  if (options.secure) parts.push('Secure');
  parts.push('SameSite=Lax');
  return parts.join('; ');
}

/**
 * `Set-Cookie` values that delete the session cookie under both names. The `__Host-` variant
 * always carries `Secure` (browsers ignore it otherwise); the plain one follows the config.
 */
export function clearSessionCookies(secure: boolean): string[] {
  return [
    serializeCookie(SECURE_COOKIE_NAMES.session, '', { secure: true, maxAge: 0 }),
    serializeCookie(DEV_COOKIE_NAMES.session, '', { secure, maxAge: 0 }),
  ];
}

/**
 * Value of cookie `name` from the request's `Cookie` header. Returns undefined when the cookie is
 * missing or appears more than once (an ambiguous jar is treated as no cookie rather than
 * guessing which one the browser meant).
 */
export function readCookie(headers: IncomingHttpHeaders, name: string): string | undefined {
  const header = headers.cookie;
  if (!header) return undefined;
  let found: string | undefined;
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index <= 0 || part.slice(0, index).trim() !== name) continue;
    if (found !== undefined) return undefined;
    found = part.slice(index + 1).trim();
  }
  return found;
}
