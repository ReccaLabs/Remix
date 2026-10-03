import { Inject, Injectable } from '@nestjs/common';
import type { Response } from 'express';
import { TRUSTED_DEVICE_DAYS } from '@remix/types/api';
import { CLOCK, type Clock } from '../../common/time/clock';
import { APP_CONFIG, type AppConfig } from '../../config/config';
import { clearSessionCookies, cookieNames, serializeCookie, type CookieNames } from './cookies';
import { DEVICE_COOKIE_MAX_AGE_SEC, sessionCookieMaxAge } from './lifetimes';
import type { LoginResult } from './session-issuer';
import type { SessionRecord } from './session.service';

/**
 * Writes the auth cookies (ADR 0004): host-only, `HttpOnly`, `SameSite=Lax`, `Secure` with
 * `COOKIE_SECURE` (and then the `__Host-` names). Tokens only ever travel in `Set-Cookie`.
 */
@Injectable()
export class AuthCookies {
  private readonly names: CookieNames;

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {
    this.names = cookieNames(config.cookieSecure);
  }

  /** Session cookie + device cookie (re-set on every sign-in so it keeps its 400 days). */
  signedIn(res: Response, result: LoginResult): void {
    this.session(res, result.sessionToken, result.session);
    res.append(
      'Set-Cookie',
      serializeCookie(this.names.device, result.deviceToken, {
        secure: this.config.cookieSecure,
        maxAge: DEVICE_COOKIE_MAX_AGE_SEC,
      }),
    );
  }

  session(res: Response, token: string, session: SessionRecord): void {
    const maxAge = sessionCookieMaxAge(session, this.clock.now());
    res.append(
      'Set-Cookie',
      serializeCookie(this.names.session, token, {
        secure: this.config.cookieSecure,
        ...(maxAge === undefined ? {} : { maxAge }),
      }),
    );
  }

  /** "Trust this computer" for 30 days (AUTH-05). */
  trust(res: Response, token: string): void {
    res.append(
      'Set-Cookie',
      serializeCookie(this.names.trust, token, {
        secure: this.config.cookieSecure,
        maxAge: TRUSTED_DEVICE_DAYS * 24 * 60 * 60,
      }),
    );
  }

  clearSession(res: Response): void {
    res.append('Set-Cookie', clearSessionCookies(this.config.cookieSecure));
  }
}
