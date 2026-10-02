import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Params } from 'nestjs-pino';
import type { Options } from 'pino-http';
import { type DestinationStream, stdSerializers, stdTimeFunctions } from 'pino';
import type { AppConfig } from '../../config/config';
import { contextLogFields, contextOf, currentContext } from '../context/request-context';

/** Field names that are always censored, at any of the first three nesting levels. */
const SECRET_FIELDS = [
  'authorization',
  'cookie',
  'set-cookie',
  'password',
  'newPassword',
  'currentPassword',
  'token',
  'accessToken',
  'refreshToken',
  'secret',
  'otp',
];

export const REDACT_PATHS = SECRET_FIELDS.flatMap((f) => {
  const key = /^[A-Za-z_$][\w$]*$/.test(f) ? f : `["${f}"]`;
  const dot = key.startsWith('[') ? '' : '.';
  return [key, `*${dot}${key}`, `*.*${dot}${key}`];
});

/** Path without the query string — queries can carry tokens or personal data. */
export function pathOnly(url: string | undefined): string | undefined {
  return url?.split('?')[0];
}

interface SerializedReq {
  id?: unknown;
  method?: string;
  url?: string;
}

/**
 * Structured JSON logging (pino). Every request-scoped line carries `requestId`, `tenantId` and
 * `userId` (ids only). Requests are logged as method + path + status: no headers, query strings,
 * bodies or IPs, so cookies, tokens and personal data never reach the logs; `redact` is the
 * second line of defence for objects logged by hand.
 */
export function loggerParams(config: AppConfig, destination?: DestinationStream): Params {
  const options: Options = {
    level: config.logLevel,
    base: { service: 'api' },
    timestamp: stdTimeFunctions.isoTime,
    formatters: { level: (label) => ({ level: label }) },
    redact: { paths: REDACT_PATHS, censor: '[redacted]' },
    // In-request lines: context from AsyncLocalStorage, read at log time (tenant/user are set
    // by guards after the line's logger was created).
    mixin: () => contextLogFields(currentContext()),
    serializers: {
      req: (req: SerializedReq) => ({ id: req.id, method: req.method, url: pathOnly(req.url) }),
      res: (res: { statusCode?: number }) => ({ statusCode: res.statusCode }),
      err: stdSerializers.err,
    },
    genReqId: (req: IncomingMessage) => contextOf(req)?.requestId ?? randomUUID(),
    // The completion line is written from the response's `finish` event; take the context from
    // the request object so it is right even if async context was lost on the way.
    customSuccessObject: (req: IncomingMessage, _res: ServerResponse, value: object) => ({
      ...value,
      ...contextLogFields(contextOf(req)),
    }),
    customErrorObject: (
      req: IncomingMessage,
      _res: ServerResponse,
      _err: Error,
      value: object,
    ) => ({
      ...value,
      ...contextLogFields(contextOf(req)),
    }),
    customLogLevel: (_req, res, err) => (err || res.statusCode >= 500 ? 'error' : 'info'),
    autoLogging: { ignore: (req) => pathOnly(req.url)?.startsWith('/health') ?? false },
  };
  return { pinoHttp: destination ? [options, destination] : options };
}
