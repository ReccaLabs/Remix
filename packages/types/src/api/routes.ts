import type { z } from 'zod';
import { sessionResponseSchema, staffLoginRequestSchema, studentLoginRequestSchema } from './auth';
import { myClassesResponseSchema } from './classes';
import { tenantPublicSchema } from './tenant';

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface EndpointDef {
  method: HttpMethod;
  /** Absolute path on the current host. The browser always calls it same-origin (ADR 0003). */
  path: `/api/v1/${string}`;
  /** Request body schema (strict). Absent → no body. */
  request?: z.ZodType;
  /** Success body schema. Absent → 204 No Content. */
  response?: z.ZodType;
}

/**
 * The API contract — one entry per endpoint. `apps/api` controllers validate with these schemas
 * and `apps/web` calls them through `createApiClient`. Change a schema here and both sides
 * fail typecheck until they agree.
 */
export const API = {
  /** TEN-01 — public info about the institute that owns the request host. */
  tenant: { method: 'GET', path: '/api/v1/tenant', response: tenantPublicSchema },

  /** AUTH-01 — sets the host-only session cookie. */
  studentLogin: {
    method: 'POST',
    path: '/api/v1/auth/student/login',
    request: studentLoginRequestSchema,
    response: sessionResponseSchema,
  },
  /** AUTH-05 (basic; 2-step comes in Phase 2). */
  staffLogin: {
    method: 'POST',
    path: '/api/v1/auth/staff/login',
    request: staffLoginRequestSchema,
    response: sessionResponseSchema,
  },
  /** Revokes the current session and clears the cookie. Always 204, even without a session. */
  logout: { method: 'POST', path: '/api/v1/auth/logout' },
  /**
   * Rotates the session token when it is ≥ 15 min old (no-op otherwise) and re-sets the cookie.
   * Called only from the web app's `proxy.ts`, which can set cookies (ADR 0004).
   */
  refreshSession: {
    method: 'POST',
    path: '/api/v1/auth/session/refresh',
    response: sessionResponseSchema,
  },
  /** The signed-in user on this host, or 401 UNAUTHENTICATED. */
  session: { method: 'GET', path: '/api/v1/auth/session', response: sessionResponseSchema },

  /** The signed-in student's enrolled classes. */
  myClasses: { method: 'GET', path: '/api/v1/me/classes', response: myClassesResponseSchema },
} as const satisfies Record<string, EndpointDef>;

export type ApiName = keyof typeof API;
type Def<N extends ApiName> = (typeof API)[N];

/** What the caller passes (before schema defaults/transforms). */
export type ApiInput<N extends ApiName> =
  Def<N> extends { request: infer S extends z.ZodType } ? z.input<S> : undefined;

/** What the caller gets back (after parsing). */
export type ApiOutput<N extends ApiName> =
  Def<N> extends { response: infer S extends z.ZodType } ? z.output<S> : undefined;
