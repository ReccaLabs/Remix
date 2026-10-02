import {
  Delete,
  Get,
  HttpCode,
  Patch,
  Post,
  Put,
  SetMetadata,
  applyDecorators,
} from '@nestjs/common';
import type { z } from 'zod';
import type { EndpointDef, HttpMethod } from '@remix/types/api';

export const API_PREFIX = 'api/v1';
export const ENDPOINT_METADATA = 'remix:endpoint';

/** Parsed request body of an endpoint (after defaults/transforms — e.g. normalised phone). */
export type EndpointBody<D extends EndpointDef> = D extends { request: infer S extends z.ZodType }
  ? z.output<S>
  : never;

/** What a handler for `D` must return: the response schema's input, or nothing (204). */
export type EndpointResult<D extends EndpointDef> = D extends {
  response: infer S extends z.ZodType;
}
  ? z.input<S>
  : undefined;

type Handler<D extends EndpointDef> = (
  ...args: never[]
) => EndpointResult<D> | Promise<EndpointResult<D>>;

const ROUTE: Record<HttpMethod, (path: string) => MethodDecorator> = {
  GET: Get,
  POST: Post,
  PUT: Put,
  PATCH: Patch,
  DELETE: Delete,
};

/**
 * Bind a handler to an entry of the `API` registry (`@remix/types/api`) — the single source of
 * method, path and schemas shared with the web client:
 *
 * ```ts
 * @Controller()
 * export class AuthController {
 *   @Endpoint(API.studentLogin)
 *   login(@Body() body: EndpointBody<typeof API.studentLogin>) { … }
 * }
 * ```
 *
 * The global {@link EndpointInterceptor} then parses the body with the strict request schema
 * (unknown fields → 400) and serialises the result through the response schema, so a handler
 * can't leak a field the contract doesn't declare. The handler's return type is checked against
 * the contract at compile time. Controllers using it must have no path prefix (checked at boot).
 */
export function Endpoint<D extends EndpointDef>(
  def: D,
  options: { status?: 200 | 201 | 202 } = {},
) {
  const path = def.path.slice(`/${API_PREFIX}/`.length);
  const decorate = applyDecorators(
    ROUTE[def.method](path),
    HttpCode(def.response ? (options.status ?? 200) : 204),
    SetMetadata(ENDPOINT_METADATA, def),
  );
  return <T extends Handler<D>>(
    target: object,
    key: string | symbol,
    descriptor: TypedPropertyDescriptor<T>,
  ): void => {
    decorate(target, key, descriptor);
  };
}
