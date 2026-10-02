import { NextResponse, type NextRequest } from 'next/server';
import { classifyHost, normalizeHost } from '@/lib/host';
import { REQUEST_HEADERS, resolveRequestId } from '@/lib/request-headers';
import { decideRoute, NOT_FOUND_PATH, type RouteDecision } from '@/lib/routing';
import { createNonce, securityHeaders } from '@/lib/security-headers';
import { hostConfig } from '@/server/env';

/**
 * Host → area routing (TEN-01) and security headers (DEVELOPMENT.md §5.3).
 *
 * 1. Classify the `Host` header: platform host → `/platform/…`, tenant base-domain sub-domain or
 *    possible custom domain → `/tenant/…`, anything else → 404.
 * 2. Rewrite into the area's internal segment. Direct requests to `/tenant/…` or `/platform/…`
 *    404, so the area can only be chosen by the host.
 * 3. Hand server code the classified host/area via request headers it overwrites (clients can't
 *    inject them), plus a fresh CSP nonce that Next.js stamps on its scripts.
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
  const requestHeaders = forwardRequestHeaders(request, decision, {
    host: normalizeHost(rawHost),
    nonce,
    requestId,
    csp: headers['Content-Security-Policy'] ?? '',
  });

  // Session refresh (Wave 2) slots in here, before the rewrite, for `decision.action ===
  // 'rewrite'`: call POST /api/v1/auth/session/refresh with the same allow-listed headers as
  // server/api.ts, replace `cookie` in `requestHeaders` with the rotated value so this render
  // sees the new session, and copy the API's Set-Cookie onto `response` below.

  const url = request.nextUrl.clone();
  url.pathname = decision.action === 'rewrite' ? decision.pathname : NOT_FOUND_PATH;

  const response = NextResponse.rewrite(url, { request: { headers: requestHeaders } });
  for (const [name, value] of Object.entries(headers)) response.headers.set(name, value);
  response.headers.set(REQUEST_HEADERS.requestId, requestId);
  return response;
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
