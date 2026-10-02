import { pickAuthCookies } from './cookies';
import { REQUEST_HEADERS } from './request-headers';

/** What a server-side API call forwards about the visitor's request (ADR 0006). */
export interface ForwardedContext {
  /** Normalised host the proxy classified. */
  host: string | null;
  cookie: string | null;
  requestId: string | null;
  forwardedFor: string | null;
  forwardedProto: string | null;
}

/**
 * Headers for an API call made on behalf of the current request — an allow-list (ADR 0006).
 * Built from scratch, so nothing else from the browser request leaks through; in particular
 * never `origin` or `sec-fetch-*`, which the API's CSRF check reads for browser calls only.
 * Shared by Server Components (`server/api.ts`) and the proxy's session refresh.
 */
export function forwardedHeaders(ctx: ForwardedContext): Headers {
  const h = new Headers();
  // Only the ReMix session and device cookies — never analytics or other site cookies.
  const cookie = pickAuthCookies(ctx.cookie);
  if (cookie) h.set('cookie', cookie);
  if (ctx.host) h.set('x-forwarded-host', ctx.host);
  if (ctx.forwardedProto) h.set('x-forwarded-proto', ctx.forwardedProto);
  // The X-Forwarded-For chain exactly as the edge proxy delivered it. The API (which lists web
  // nodes in TRUST_PROXY) takes the right-most untrusted address as the client IP, so per-IP
  // limits apply to the visitor, not to this web node. App Router code can't see the TCP peer,
  // so the web server can't apply TRUST_PROXY itself; passing the chain gives the same result.
  if (ctx.forwardedFor) h.set('x-forwarded-for', ctx.forwardedFor);
  if (ctx.requestId) h.set(REQUEST_HEADERS.requestId, ctx.requestId);
  return h;
}
