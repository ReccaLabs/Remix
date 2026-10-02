import 'server-only';
import { headers } from 'next/headers';
import { cache } from 'react';
import { REQUEST_HEADERS } from '@/lib/request-headers';
import type { Area } from '@/lib/routing';

export interface RequestContext {
  /** Set by the proxy; `null` only if the proxy did not run (then nothing tenant-related renders). */
  area: Area | null;
  /** Normalised host the proxy classified — the only host server code may trust. */
  host: string | null;
  requestId: string | null;
  cookie: string | null;
  /** As received from the edge proxy (Kamal in prod); the API trusts it only from known proxies. */
  forwardedFor: string | null;
  forwardedProto: string | null;
  nonce: string | null;
  /** Browser-facing path + query of this request (set by the proxy), for login `?next=`. */
  path: string | null;
}

/** What the proxy established about this request (see `src/proxy.ts`). Reading it is dynamic. */
export const getRequestContext = cache(async (): Promise<RequestContext> => {
  const h = await headers();
  const area = h.get(REQUEST_HEADERS.area);
  return {
    area: area === 'tenant' || area === 'platform' ? area : null,
    host: h.get(REQUEST_HEADERS.host),
    requestId: h.get(REQUEST_HEADERS.requestId),
    cookie: h.get('cookie'),
    forwardedFor: h.get('x-forwarded-for'),
    forwardedProto: h.get('x-forwarded-proto'),
    nonce: h.get(REQUEST_HEADERS.nonce),
    path: h.get(REQUEST_HEADERS.path),
  };
});
