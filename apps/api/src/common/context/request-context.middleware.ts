import { randomUUID } from 'node:crypto';
import type { TLSSocket } from 'node:tls';
import type { RequestHandler } from 'express';
import { resolveForwarded } from '../http/forwarded';
import type { TrustedProxies } from '../http/trusted-proxy';
import { attachContext, contextOf, createRequestContext, runWithContext } from './request-context';

/** Accepted shape of an inbound `x-request-id` (the web app sends a UUID). */
const REQUEST_ID = /^[A-Za-z0-9_-]{8,64}$/;

/**
 * First middleware of every request: derives host / scheme / client IP from trusted forwarding
 * only, assigns the request id (echoed as `x-request-id`) and opens the AsyncLocalStorage
 * context. An inbound `x-request-id` is kept only from a trusted proxy (the web app, ADR 0006),
 * so web and API log lines correlate; anyone else gets a fresh UUID.
 */
export function requestContextMiddleware(trust: TrustedProxies): RequestHandler {
  return (req, res, next) => {
    const forwarded = resolveForwarded(
      {
        headers: req.headers,
        remoteAddress: req.socket.remoteAddress,
        encrypted: (req.socket as Partial<TLSSocket>).encrypted === true,
      },
      trust,
    );
    const inbound = req.headers['x-request-id'];
    const requestId =
      forwarded.viaTrustedProxy && typeof inbound === 'string' && REQUEST_ID.test(inbound)
        ? inbound
        : randomUUID();

    const ctx = createRequestContext({
      requestId,
      host: forwarded.host,
      protocol: forwarded.protocol,
      origin: forwarded.origin,
      clientIp: forwarded.clientIp,
    });
    attachContext(req, ctx);
    res.setHeader('x-request-id', requestId);
    runWithContext(ctx, next);
  };
}

/**
 * Re-enters the request's context. Placed after the body parser: its callback fires from the
 * socket's stream events, which can run outside the context opened by the first middleware.
 */
export const rebindRequestContext: RequestHandler = (req, _res, next) => {
  const ctx = contextOf(req);
  if (ctx) runWithContext(ctx, next);
  else next();
};
