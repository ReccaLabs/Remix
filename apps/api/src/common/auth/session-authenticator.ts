import type { Request, Response } from 'express';
import type { StaffRole, UserKind } from '@remix/types/api';
import type { ResolvedTenant } from '../tenant/tenant-resolver';

/** Roles a guard can require. Platform staff roles join this union when that module lands. */
export type Role = StaffRole;

/** An authenticated session, as the guards and handlers see it. Ids and roles only — no PII. */
export interface AuthSession {
  sessionId: string;
  userId: string;
  /** Tenant the session belongs to; null for platform staff sessions. */
  tenantId: string | null;
  kind: UserKind | 'platform';
  roles: readonly Role[];
  /** Platform staff id when this is an impersonation session (30 min, audited). */
  impersonatedBy?: string;
}

export interface AuthenticateInput {
  req: Request;
  /** For setting/clearing the session cookie (e.g. clearing an expired one). */
  res: Response;
  /** Resolved tenant for tenant hosts, null on platform hosts. */
  tenant: ResolvedTenant | null;
}

/**
 * Turns the request's session cookie into a session. Track E implements it (opaque 256-bit
 * token, SHA-256 lookup, host-only cookie — ADR 0004). Returns null for a missing, expired,
 * revoked or foreign session; never throws for a bad cookie.
 *
 * The auth guard additionally checks that a tenant session belongs to the request's tenant and
 * that platform hosts only accept platform sessions, so implementations can't get that wrong.
 */
export interface SessionAuthenticator {
  authenticate(input: AuthenticateInput): Promise<AuthSession | null>;
}

/** DI token for {@link SessionAuthenticator}. */
export const SESSION_AUTHENTICATOR = Symbol('SessionAuthenticator');

/** Default until auth lands: nobody is signed in (every non-public route answers 401). */
export class NullSessionAuthenticator implements SessionAuthenticator {
  authenticate(): Promise<AuthSession | null> {
    return Promise.resolve(null);
  }
}
