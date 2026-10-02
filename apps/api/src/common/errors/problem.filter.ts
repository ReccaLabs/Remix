import { type ArgumentsHost, Catch, type ExceptionFilter } from '@nestjs/common';
import type { ErrorRequestHandler, Response } from 'express';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { PROBLEM_CONTENT_TYPE } from '@remix/types/api';
import { contextOf } from '../context/request-context';
import { toProblem, type RenderedProblem } from './problem';

/** Write a problem document. Errors are never cached. */
export function sendProblem(res: Response, { problem, headers }: RenderedProblem): void {
  if (res.headersSent) {
    res.end();
    return;
  }
  res.status(problem.status);
  for (const [name, value] of Object.entries(headers)) res.setHeader(name, value);
  res.setHeader('cache-control', 'no-store');
  res.setHeader('content-type', `${PROBLEM_CONTENT_TYPE}; charset=utf-8`);
  res.send(JSON.stringify(problem));
}

/**
 * Global exception filter: every error leaving a controller, guard, pipe or interceptor becomes
 * an RFC 9457 problem (see {@link toProblem}). Unexpected errors are logged with their stack —
 * server-side only — and the client gets a generic 500 with the request id for support.
 */
@Catch()
export class ProblemFilter implements ExceptionFilter {
  constructor(@InjectPinoLogger(ProblemFilter.name) private readonly logger: PinoLogger) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const res = http.getResponse<Response>();
    const requestId = contextOf(http.getRequest())?.requestId;
    const rendered = toProblem(exception, requestId);
    if (rendered.unexpected) {
      // `err` goes through serializeError (logger.ts): a failed query is logged without its SQL,
      // bound parameters or row detail.
      this.logger.error({ err: exception }, 'Unhandled error while processing request');
    }
    sendProblem(res, rendered);
  }
}

/**
 * Express error middleware for failures before Nest routing (the JSON body parser: malformed
 * JSON, payload too large, unsupported charset). Without it Express would answer with HTML.
 */
export const bodyParserErrorHandler: ErrorRequestHandler = (error, req, res, next) => {
  const rendered = toProblem(error, contextOf(req)?.requestId);
  if (rendered.unexpected) {
    next(error);
    return;
  }
  sendProblem(res, rendered);
};
