import { Inject, Injectable } from '@nestjs/common';
import type {
  AuthenticateInput,
  AuthSession,
  SessionAuthenticator,
} from '../../common/auth/session-authenticator';
import { APP_CONFIG, type AppConfig } from '../../config/config';
import { clearSessionCookies, cookieNames, readCookie } from './cookies';
import { attachSessionRecord, SessionService, toAuthSession } from './session.service';
import { parseSessionToken } from './tokens';

/**
 * `SESSION_AUTHENTICATOR` backed by the `sessions` table (ADR 0004). Reads only the configured
 * cookie name (`__Host-remix_session` with secure cookies), parses the token strictly, and looks
 * its SHA-256 up inside the host tenant's `withTenant`. Platform hosts have no tenant sessions
 * yet (AUTH-06), so they always get null. A dead session's cookie is cleared on the response.
 */
@Injectable()
export class DbSessionAuthenticator implements SessionAuthenticator {
  private readonly cookieName: string;

  constructor(
    private readonly sessions: SessionService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {
    this.cookieName = cookieNames(config.cookieSecure).session;
  }

  async authenticate({ req, res, tenant }: AuthenticateInput): Promise<AuthSession | null> {
    if (!tenant) return null;
    const parsed = parseSessionToken(readCookie(req.headers, this.cookieName));
    if (!parsed) return null;

    const result = await this.sessions.lookup(tenant.id, parsed.token);
    if (result.status === 'none') {
      if (result.dead) res.append('Set-Cookie', clearSessionCookies(this.config.cookieSecure));
      return null;
    }
    if (result.session.tenantId !== tenant.id) return null;
    attachSessionRecord(req, result.session);
    return toAuthSession(result.session);
  }
}
