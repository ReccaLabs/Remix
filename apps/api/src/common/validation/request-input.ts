import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { EndpointDef } from '@remix/types/api';
import type { Request } from 'express';
import { ENDPOINT_METADATA } from './endpoint';

function parseWith(context: ExecutionContext, part: 'params' | 'query'): unknown {
  const def = Reflect.getMetadata(ENDPOINT_METADATA, context.getHandler()) as
    EndpointDef | undefined;
  const schema = def?.[part];
  if (!schema) throw new Error(`@Endpoint(...) of this handler declares no ${part} schema`);
  const req = context.switchToHttp().getRequest<Request>();
  // ZodError → 400 VALIDATION_FAILED with field paths (problem filter). Unknown keys are rejected
  // because the contract schemas are strict.
  return schema.parse(req[part]);
}

/** Path params of an `@Endpoint` parsed with its `params` schema (strict; 400 when invalid). */
export const EndpointParams = createParamDecorator((_: unknown, context: ExecutionContext) =>
  parseWith(context, 'params'),
);

/** Query string of an `@Endpoint` parsed with its `query` schema (strict, coerced; 400 invalid). */
export const EndpointQuery = createParamDecorator((_: unknown, context: ExecutionContext) =>
  parseWith(context, 'query'),
);
