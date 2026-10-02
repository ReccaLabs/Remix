import { RequestMethod } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import { Logger } from 'nestjs-pino';
import { bodyParserErrorHandler } from './common/errors/problem.filter';
import {
  rebindRequestContext,
  requestContextMiddleware,
} from './common/context/request-context.middleware';
import { API_PREFIX } from './common/validation/endpoint';
import type { AppConfig } from './config/config';

/** JSON bodies above this are rejected with 413 before any handler runs. */
export const BODY_LIMIT = '100kb';

/**
 * Everything about the HTTP layer that isn't a module: shared by `main.ts` and the e2e tests so
 * tests exercise exactly what production runs. The app must be created with
 * `{ bodyParser: false, bufferLogs: true }`.
 */
export function configureApp(app: NestExpressApplication, config: AppConfig): void {
  app.useLogger(app.get(Logger));
  app.flushLogs();

  app.disable('x-powered-by');
  // Same rule as our own forwarding logic, so `req.ip`/`req.protocol` agree with the context.
  app.set('trust proxy', (address: string) => config.trustProxy.isTrusted(address));

  // Order matters: context first (request id on every response, even body errors), then
  // security headers, then the JSON parser and its error handler, then re-enter the context.
  app.use(requestContextMiddleware(config.trustProxy));
  app.use(
    helmet({
      // JSON API: nothing may load, frame or execute from our responses.
      contentSecurityPolicy: {
        useDefaults: false,
        directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"], baseUri: ["'none'"] },
      },
      crossOriginResourcePolicy: { policy: 'same-origin' },
      referrerPolicy: { policy: 'no-referrer' },
      xFrameOptions: { action: 'deny' },
      strictTransportSecurity: config.nodeEnv === 'production',
    }),
  );
  // Only JSON is parsed. Other content types leave the body empty, and the CSRF guard rejects
  // them on state-changing methods.
  app.useBodyParser('json', { limit: BODY_LIMIT, type: 'application/json', strict: true });
  app.use(bodyParserErrorHandler);
  app.use(rebindRequestContext);

  // No CORS by design (ADR 0003): every browser call is same-origin. Never call enableCors().
  app.setGlobalPrefix(API_PREFIX, {
    exclude: [
      { path: 'health', method: RequestMethod.GET },
      { path: 'health/ready', method: RequestMethod.GET },
    ],
  });
  app.enableShutdownHooks();
}
