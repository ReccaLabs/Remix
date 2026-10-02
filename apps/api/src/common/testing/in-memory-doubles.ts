import type {
  AuthenticateInput,
  AuthSession,
  SessionAuthenticator,
} from '../auth/session-authenticator';
import type { ResolvedTenant, TenantResolver } from '../tenant/tenant-resolver';

/** Test double: a fixed host → tenant map. Counts lookups so tests can assert caching/skips. */
export class InMemoryTenantResolver implements TenantResolver {
  lookups = 0;
  private readonly byHost: Map<string, ResolvedTenant>;

  constructor(hosts: Record<string, ResolvedTenant>) {
    this.byHost = new Map(Object.entries(hosts));
  }

  resolve(host: string): Promise<ResolvedTenant | null> {
    this.lookups += 1;
    return Promise.resolve(this.byHost.get(host) ?? null);
  }
}

/** Cookie the test authenticator reads (`sid=<token>`). The real name is Track E's call. */
export const TEST_SESSION_COOKIE = 'sid';

/** Test double: session tokens → sessions, read from the `sid` cookie. */
export class InMemorySessionAuthenticator implements SessionAuthenticator {
  lookups = 0;
  private readonly sessions = new Map<string, AuthSession>();

  add(token: string, session: AuthSession): this {
    this.sessions.set(token, session);
    return this;
  }

  authenticate({ req }: AuthenticateInput): Promise<AuthSession | null> {
    this.lookups += 1;
    const token = readCookie(req.headers.cookie, TEST_SESSION_COOKIE);
    return Promise.resolve(token ? (this.sessions.get(token) ?? null) : null);
  }
}

/** Minimal `Cookie` header reader (first match wins). */
export function readCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index > 0 && part.slice(0, index).trim() === name) return part.slice(index + 1).trim();
  }
  return undefined;
}
