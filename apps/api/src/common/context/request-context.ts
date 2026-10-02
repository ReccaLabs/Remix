import { AsyncLocalStorage } from 'node:async_hooks';
import type { IncomingMessage } from 'node:http';
import type { AuthSession } from '../auth/session-authenticator';
import type { ResolvedTenant } from '../tenant/tenant-resolver';

/**
 * Per-request state, reachable from anywhere in the call chain (services, repositories, the
 * logger) without threading it through every signature. Created by the request-context
 * middleware; `tenant` and `session` are filled in by the tenant and auth guards.
 */
export interface RequestContext {
  readonly requestId: string;
  /** Normalised host the browser asked for (from trusted forwarding only), or null if invalid. */
  readonly host: string | null;
  /** Scheme the browser used (from trusted forwarding only). */
  readonly protocol: 'http' | 'https';
  /** `scheme://host[:port]` the browser used; what a same-origin `Origin` header must equal. */
  readonly origin: string | null;
  /** Client address for rate limiting / security events. Personal data: never log it. */
  readonly clientIp: string | null;
  /** Which area the host belongs to; set by the tenant guard. */
  area: 'tenant' | 'platform' | null;
  tenant: ResolvedTenant | null;
  session: AuthSession | null;
}

const storage = new AsyncLocalStorage<RequestContext>();

/** Key under which the context is also attached to the raw request (for code outside ALS). */
const CONTEXT_KEY = Symbol('remix.requestContext');

type WithContext = IncomingMessage & { [CONTEXT_KEY]?: RequestContext };

export function createRequestContext(
  init: Pick<RequestContext, 'requestId' | 'host' | 'protocol' | 'origin' | 'clientIp'>,
): RequestContext {
  return { ...init, area: null, tenant: null, session: null };
}

/** Run `fn` with `ctx` as the current request context. */
export function runWithContext<T>(ctx: RequestContext, fn: () => T): T {
  return storage.run(ctx, fn);
}

/** The current request context, or undefined outside a request (boot, workers, timers). */
export function currentContext(): RequestContext | undefined {
  return storage.getStore();
}

/** The current request context; throws when called outside a request. */
export function requireContext(): RequestContext {
  const ctx = storage.getStore();
  if (!ctx) throw new Error('No request context — called outside an HTTP request');
  return ctx;
}

export function attachContext(req: IncomingMessage, ctx: RequestContext): void {
  (req as WithContext)[CONTEXT_KEY] = ctx;
}

export function contextOf(req: IncomingMessage): RequestContext | undefined {
  return (req as WithContext)[CONTEXT_KEY];
}

/** Log fields every request-scoped line carries. Ids only — never names, phones or emails. */
export function contextLogFields(ctx: RequestContext | undefined): Record<string, string | null> {
  if (!ctx) return {};
  return {
    requestId: ctx.requestId,
    tenantId: ctx.tenant?.id ?? null,
    userId: ctx.session?.userId ?? null,
  };
}
