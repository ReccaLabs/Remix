import type { IncomingHttpHeaders } from 'node:http';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export interface CsrfInput {
  method: string;
  headers: IncomingHttpHeaders;
  /** The request's own origin (`scheme://host[:port]`) from trusted forwarding; null if unknown. */
  ownOrigin: string | null;
}

export type CsrfVerdict =
  | { ok: true }
  | { ok: false; status: 403 | 415; reason: 'sec-fetch-site' | 'origin' | 'content-type' };

/**
 * ADR 0003 CSRF check for state-changing requests. Safe methods always pass. Otherwise:
 *
 * 1. `Sec-Fetch-Site`, if present, must be `same-origin` or `none` (`same-site` is exactly the
 *    sibling-tenant attack: `evil.remix.lk` → `kamal.remix.lk`).
 * 2. `Origin`, if present, must equal the request's own origin; `Origin: null` is rejected.
 * 3. `Content-Type` must be `application/json` — on every unsafe request, bodyless ones included
 *    (the typed client sends `{}`). JSON is not CORS-safelisted, so a cross-origin form or
 *    `fetch` needs a preflight, which fails because the API sends no CORS headers.
 *
 * Requests with neither `Origin` nor `Sec-Fetch-Site` are non-browser (server-to-server from the
 * web app, ADR 0006): a script can't attach a victim's ambient cookies, so rules 1–2 don't apply
 * to them, but rule 3 still does.
 */
export function checkCsrf({ method, headers, ownOrigin }: CsrfInput): CsrfVerdict {
  if (SAFE_METHODS.has(method.toUpperCase())) return { ok: true };

  const fetchSite = headerValue(headers['sec-fetch-site']);
  if (fetchSite !== undefined) {
    const site = fetchSite.trim().toLowerCase();
    if (site !== 'same-origin' && site !== 'none') {
      return { ok: false, status: 403, reason: 'sec-fetch-site' };
    }
  }

  const origin = headerValue(headers.origin);
  if (origin !== undefined && !sameOrigin(origin, ownOrigin)) {
    return { ok: false, status: 403, reason: 'origin' };
  }

  if (!isJsonContentType(headerValue(headers['content-type']))) {
    return { ok: false, status: 415, reason: 'content-type' };
  }
  return { ok: true };
}

/** `application/json`, optionally with parameters (`; charset=utf-8`). Nothing else. */
export function isJsonContentType(value: string | undefined): boolean {
  if (!value) return false;
  const [type = ''] = value.split(';');
  return type.trim().toLowerCase() === 'application/json';
}

function sameOrigin(origin: string, ownOrigin: string | null): boolean {
  if (!ownOrigin) return false;
  const value = origin.trim();
  if (value === '' || value.toLowerCase() === 'null') return false;
  try {
    // URL.origin lower-cases the host and drops a default port, like our own origin.
    return new URL(value).origin === ownOrigin;
  } catch {
    return false;
  }
}

function headerValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value.join(',') : value;
}
