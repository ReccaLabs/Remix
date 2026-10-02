import 'server-only';
import {
  ApiError,
  createApiClient,
  type ApiClient,
  type ErrorCode,
  type SessionResponse,
  type StaffRole,
  type TenantPublic,
} from '@remix/types/api';
import { notFound, redirect } from 'next/navigation';
import { cache } from 'react';
import { pickAuthCookies } from '@/lib/cookies';
import { TENANT_PATHS } from '@/lib/paths';
import { REQUEST_HEADERS } from '@/lib/request-headers';
import { getEnv } from './env';
import { getRequestContext, type RequestContext } from './request';

/**
 * Server-side access to the API (ADR 0006): `apps/web` never touches the database. Every call
 * goes to `API_INTERNAL_URL` with the visitor's cookie and the tenant host, so the API applies
 * exactly the same tenant resolution and session rules as for a browser call.
 */

/** Upper bound for one API call during a render; a hung API must not hang the page. */
export const API_TIMEOUT_MS = 10_000;

type ForwardedContext = Pick<
  RequestContext,
  'host' | 'cookie' | 'requestId' | 'forwardedFor' | 'forwardedProto'
>;

/**
 * Headers for an API call made on behalf of the current request — an allow-list (ADR 0006).
 * Built from scratch, so nothing else from the browser request leaks through; in particular
 * never `origin` or `sec-fetch-*`, which the API's CSRF check reads for browser calls only.
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

/** The API error code of a failed call (`UNAUTHENTICATED`, `TENANT_UNAVAILABLE`…), else `null`. */
export function problemCode(err: unknown): ErrorCode | null {
  return err instanceof ApiError ? err.problem.code : null;
}

export function createServerApi(
  ctx: ForwardedContext,
  options: { baseUrl?: string; fetch?: typeof fetch } = {},
): ApiClient {
  const doFetch = options.fetch ?? fetch;
  return createApiClient({
    baseUrl: options.baseUrl ?? getEnv().API_INTERNAL_URL,
    headers: () => forwardedHeaders(ctx),
    fetch: (input, init) =>
      doFetch(input, { ...init, signal: init?.signal ?? AbortSignal.timeout(API_TIMEOUT_MS) }),
  });
}

/** One API client per request, bound to the proxy-established host and the visitor's cookie. */
export const getApi = cache(async (): Promise<ApiClient> => {
  return createServerApi(await getRequestContext());
});

/** The institute for this host, or `null` if the API doesn't know the host. */
export async function fetchTenant(api: ApiClient): Promise<TenantPublic | null> {
  try {
    return await api.call('tenant');
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return null;
    throw err;
  }
}

/** The signed-in user on this host, or `null` when there is no valid session (401). */
export async function fetchSession(api: ApiClient): Promise<SessionResponse | null> {
  try {
    return await api.call('session');
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) return null;
    throw err;
  }
}

/**
 * The institute that owns the request host (TEN-01). Cached per request, so layouts, pages and
 * metadata share one API call. Unknown host → 404. Only valid in the tenant area: the tenant
 * always comes from the proxy-classified host, never from a query string, cookie or client input.
 */
export const getTenant = cache(async (): Promise<TenantPublic> => {
  const tenant = await findTenant();
  if (!tenant) notFound();
  return tenant;
});

/**
 * Like `getTenant` but `null` instead of a 404 — for the root layout, which must render the
 * document (and the 404 page) for unknown hosts too. Shares getTenant's one API call.
 */
export const findTenant = cache(async (): Promise<TenantPublic | null> => {
  const ctx = await getRequestContext();
  if (ctx.area !== 'tenant' || !ctx.host) return null;
  return fetchTenant(await getApi());
});

/** The current session, or `null` (signed out, expired, revoked). Cached per request. */
export const getSession = cache(async (): Promise<SessionResponse | null> => {
  const ctx = await getRequestContext();
  if (!ctx.area || !ctx.host) return null;
  return fetchSession(await getApi());
});

/** A session that belongs to this host's institute (defence in depth; the API checks too). */
async function getTenantSession(): Promise<SessionResponse | null> {
  const [tenant, session] = await Promise.all([getTenant(), getSession()]);
  return session && session.user.tenantId === tenant.id ? session : null;
}

/** Student pages: signed-in student of this institute, else redirect to the student login. */
export async function requireStudent(): Promise<SessionResponse> {
  const session = await getTenantSession();
  if (!session || session.user.kind !== 'student') redirect(TENANT_PATHS.studentLogin);
  return session;
}

/**
 * Institute admin pages: signed-in staff of this institute, else redirect to the staff login.
 * With `roles`, staff without any of them get a 404 (the page's existence is not revealed).
 * UI gating only — the API enforces roles on every call.
 */
export async function requireStaff(roles?: readonly StaffRole[]): Promise<SessionResponse> {
  const session = await getTenantSession();
  if (!session || session.user.kind !== 'staff') redirect(TENANT_PATHS.staffLogin);
  if (roles && !session.user.roles.some((role) => roles.includes(role))) notFound();
  return session;
}
