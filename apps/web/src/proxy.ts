import { NextResponse, type NextRequest } from 'next/server';
import { forwardedHeaders } from '@/lib/forwarded-headers';
import { classifyHost, normalizeHost } from '@/lib/host';
import { REQUEST_HEADERS, resolveRequestId } from '@/lib/request-headers';
import { decideRoute, NOT_FOUND_PATH, type RouteDecision } from '@/lib/routing';
import { createNonce, securityHeaders } from '@/lib/security-headers';
import {
  applyCookieChanges,
  clearCookieHeader,
  parseSetCookie,
  refreshCandidate,
  requestRefresh,
  type SetCookieChange,
} from '@/lib/session-refresh';
import { getEnv, hostConfig } from '@/server/env';

/**
 * Host → area routing (TEN-01) and security headers (DEVELOPMENT.md §5.3).
 *
 * 1. Classify the `Host` header: platform host → `/platform/…`, tenant base-domain sub-domain or
 *    possible custom domain → `/tenant/…`, anything else → 404.
 * 2. Rewrite into the area's internal segment. Direct requests to `/tenant/…` or `/platform/…`
 *    404, so the area can only be chosen by the host.
 * 3. Hand server code the classified host/area via request headers it overwrites (clients can't
 *    inject them), plus a fresh CSP nonce that Next.js stamps on its scripts.
 * 4. Rotate a tenant session that is ≥ 15 min old (ADR 0004) and relay the new cookie both to
 *    the browser and to this render.
 */
export async function proxy(request: NextRequest) {
  const rawHost = request.headers.get('host');
  const decision = decideRoute(request.nextUrl.pathname, classifyHost(rawHost, hostConfig()));

  const nonce = createNonce();
  const requestId = resolveRequestId(request.headers.get(REQUEST_HEADERS.requestId));
  const headers = securityHeaders({
    nonce,
    isDev: process.env.NODE_ENV === 'development',
    hsts: process.env.NODE_ENV === 'production',
  });
  const host = normalizeHost(rawHost);
  const requestHeaders = forwardRequestHeaders(request, decision, {
    host,
    nonce,
    requestId,
    csp: headers['Content-Security-Policy'] ?? '',
  });

  const setCookies = await refreshSession(request, decision, requestHeaders, { host, requestId });

  const url = request.nextUrl.clone();
  url.pathname = decision.action === 'rewrite' ? decision.pathname : NOT_FOUND_PATH;

  const response = NextResponse.rewrite(url, { request: { headers: requestHeaders } });
  for (const [name, value] of Object.entries(headers)) response.headers.set(name, value);
  response.headers.set(REQUEST_HEADERS.requestId, requestId);
  for (const cookie of setCookies) response.headers.append('set-cookie', cookie);
  return response;
}

/**
 * Session rotation (ADR 0004). When the tenant session cookie is ≥ 15 min old, POST the API's
 * refresh endpoint with the same allow-listed headers as server/api.ts, then:
 * - 200 → return the API's Set-Cookie headers for the response, and swap the cookie in
 *   `requestHeaders` so this render already uses the new token;
 * - 401 → clear the cookie on both sides; the page's guard then redirects to login;
 * - anything else (outage, timeout) → change nothing.
 * Skipped for prefetches, the platform area and fresh or malformed tokens.
 */
async function refreshSession(
  request: NextRequest,
  decision: RouteDecision,
  requestHeaders: Headers,
  ctx: { host: string | null; requestId: string },
): Promise<string[]> {
  const secure = request.nextUrl.protocol === 'https:';
  const candidate = refreshCandidate({
    area: decision.action === 'rewrite' ? decision.area : null,
    headers: request.headers,
    secure,
    nowSeconds: Math.floor(Date.now() / 1000),
  });
  if (!candidate) return [];

  const outcome = await requestRefresh({
    apiUrl: getEnv().API_INTERNAL_URL,
    headers: forwardedHeaders({
      host: ctx.host,
      cookie: request.headers.get('cookie'),
      requestId: ctx.requestId,
      forwardedFor: request.headers.get('x-forwarded-for'),
      forwardedProto: request.headers.get('x-forwarded-proto'),
    }),
  });

  let setCookies: string[];
  let changes: SetCookieChange[];
  if (outcome.kind === 'rotated') {
    setCookies = outcome.setCookies;
    changes = setCookies.map(parseSetCookie).filter((c): c is SetCookieChange => c !== null);
  } else if (outcome.kind === 'expired') {
    setCookies = [clearCookieHeader(candidate.name, secure)];
    changes = [{ name: candidate.name, value: null }];
  } else {
    return [];
  }

  const cookie = applyCookieChanges(requestHeaders.get('cookie'), changes);
  if (cookie) requestHeaders.set('cookie', cookie);
  else requestHeaders.delete('cookie');
  return setCookies;
}

/** The request headers server code sees. Proxy-owned headers are always overwritten or removed. */
function forwardRequestHeaders(
  request: NextRequest,
  decision: RouteDecision,
  values: { host: string | null; nonce: string; requestId: string; csp: string },
): Headers {
  const h = new Headers(request.headers);
  h.delete(REQUEST_HEADERS.area);
  h.delete(REQUEST_HEADERS.host);
  if (decision.action === 'rewrite' && values.host) {
    h.set(REQUEST_HEADERS.area, decision.area);
    h.set(REQUEST_HEADERS.host, values.host);
  }
  h.set(REQUEST_HEADERS.requestId, values.requestId);
  h.set(REQUEST_HEADERS.nonce, values.nonce);
  h.set(REQUEST_HEADERS.path, `${request.nextUrl.pathname}${request.nextUrl.search}`);
  // Next.js reads the nonce from the request's CSP header while rendering.
  h.set('content-security-policy', values.csp);
  return h;
}

export const config = {
  matcher: [
    // Everything except the same-origin API (routed to apps/api beside Next), Next's build
    // assets and the public icon. Must stay a literal so Next can analyse it at build time.
    '/((?!api/v1(?:/|$)|_next/|icon\\.svg$|favicon\\.ico$).*)',
  ],
};
