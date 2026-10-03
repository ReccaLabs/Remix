import { createHash } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { LOGIN_LIMITS, OTP_RULES } from '@remix/types/api';
import { AppException } from '../../common/errors/app-exception';
import {
  RATE_LIMITER,
  RateLimiterUnavailableError,
  type RateLimiter,
} from '../../common/rate-limit/rate-limiter';

/** Window in which failures against an identifier without an account are counted (AUTH-09). */
export const UNKNOWN_LOCKOUT_WINDOW_SEC = 24 * 60 * 60;

export type SendDecision = { allowed: true } | { allowed: false; retryAfterSec: number };

/** 503 when the limiter backend is down: limits on codes and logins fail closed (ADR 0012). */
function limiterDown(): AppException {
  return new AppException('INTERNAL', 503, 'Service temporarily unavailable. Try again shortly.', {
    headers: { 'retry-after': '5' },
  });
}

/** `t:<tenantId>:<what>:<sha256(value)>` — tenant-scoped, and never a phone number in clear. */
function key(tenantId: string, what: string, value: string): string {
  const digest = createHash('sha256').update(value).digest('base64url').slice(0, 32);
  return `t:${tenantId}:${what}:${digest}`;
}

/**
 * The per-phone limits that must not show up as a different response (no enumeration), so they
 * live in the services instead of the rate-limit guard. All counters are counted for every phone,
 * with or without an account, and all of them fail closed (503) when Valkey is unreachable.
 */
@Injectable()
export class CodeSendLimits {
  constructor(@Inject(RATE_LIMITER) private readonly limiter: RateLimiter) {}

  /**
   * One SMS code to `phone`: no sooner than 45 s after the previous one, and at most 3 per
   * 15 minutes, across every purpose (password, unlock, two-step, admin reset) — SMS fraud (T7).
   * The resend gap is checked first so a too-early retry does not spend the window.
   */
  async consumeSend(tenantId: string, phone: string): Promise<SendDecision> {
    try {
      const gap = await this.limiter.consume(
        key(tenantId, 'otp-gap', phone),
        1,
        OTP_RULES.resendAfterSeconds,
      );
      if (!gap.allowed) return { allowed: false, retryAfterSec: gap.resetSec };
      const window = await this.limiter.consume(
        key(tenantId, 'otp-window', phone),
        OTP_RULES.maxPerWindow,
        OTP_RULES.windowSeconds,
      );
      if (!window.allowed) return { allowed: false, retryAfterSec: window.resetSec };
      return { allowed: true };
    } catch (error) {
      if (error instanceof RateLimiterUnavailableError) throw limiterDown();
      throw error;
    }
  }

  /**
   * Count one failed sign-in against an identifier (AUTH-09) and say whether it has now reached
   * the lockout threshold. Accounts lock in the database (`tenant_users.locked_at`, until an SMS
   * unlock); this counter is what makes an identifier *without* an account answer
   * `ACCOUNT_LOCKED` after the same number of failures, so lockout cannot be used to find out
   * which phones have accounts. It is counted for every failure, with or without an account.
   */
  async countFailure(tenantId: string, identifier: string): Promise<{ reachedLockout: boolean }> {
    try {
      const decision = await this.limiter.consume(
        key(tenantId, 'login-fail', identifier),
        LOGIN_LIMITS.lockoutAfterFailures,
        UNKNOWN_LOCKOUT_WINDOW_SEC,
      );
      return { reachedLockout: !decision.allowed || decision.remaining === 0 };
    } catch (error) {
      if (error instanceof RateLimiterUnavailableError) throw limiterDown();
      throw error;
    }
  }
}
