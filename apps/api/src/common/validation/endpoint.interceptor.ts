import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  type NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { map, type Observable } from 'rxjs';
import { ZodError } from 'zod';
import type { EndpointDef } from '@remix/types/api';
import { AppException } from '../errors/app-exception';
import { ENDPOINT_METADATA } from './endpoint';

/** The response didn't match its contract — a server bug, reported as a generic 500. */
export class ResponseContractError extends Error {
  constructor(
    readonly endpoint: string,
    /** Paths and messages only; never the offending values (they may be personal data). */
    readonly issues: readonly string[],
  ) {
    super(`Response for ${endpoint} does not match its contract: ${issues.join('; ')}`);
    this.name = 'ResponseContractError';
  }
}

/**
 * Global interceptor for routes bound with `@Endpoint(API.x)`:
 * - request: `req.body` is replaced by the strict schema's parse result (ZodError → 400 with
 *   field paths). Endpoints without a request schema accept only no body or `{}` (the typed
 *   client sends `{}` on bodyless unsafe calls, ADR 0003).
 * - response: the result is parsed with the response schema, which strips undeclared fields; a
 *   mismatch is a 500 and is logged as a contract bug. No response schema → 204, no body.
 */
@Injectable()
export class EndpointInterceptor implements NestInterceptor {
  constructor(private readonly reflector: Reflector) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const def = this.reflector.get<EndpointDef | undefined>(
      ENDPOINT_METADATA,
      context.getHandler(),
    );
    if (!def || context.getType() !== 'http') return next.handle();

    const req = context.switchToHttp().getRequest<Request>();
    const body: unknown = req.body;
    if (def.request) {
      req.body = def.request.parse(body);
    } else if (body !== undefined && !isEmptyObject(body)) {
      throw new AppException('VALIDATION_FAILED', 400, 'This request takes no body');
    }

    const label = `${def.method} ${def.path}`;
    return next.handle().pipe(
      map((result: unknown) => {
        if (!def.response) return undefined;
        try {
          return def.response.parse(result);
        } catch (error) {
          if (error instanceof ZodError) {
            throw new ResponseContractError(
              label,
              error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`),
            );
          }
          throw error;
        }
      }),
    );
  }
}

function isEmptyObject(value: unknown): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.keys(value).length === 0
  );
}
