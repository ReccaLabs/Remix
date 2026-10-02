import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import type { RateLimitRule } from '../../common/rate-limit/rate-limit.guard';
import { AuthController } from './auth.controller';

/** Metadata key written by `@RateLimit` (common/rate-limit/rate-limit.guard.ts). */
const RATE_LIMITS = 'remix:rateLimits';

/** `@RateLimit` metadata sits on the handler function itself (Nest's SetMetadata on a method). */
const rulesOf = (method: 'studentLogin' | 'staffLogin'): string[] => {
  const handler: unknown = Object.getOwnPropertyDescriptor(AuthController.prototype, method)?.value;
  return (Reflect.getMetadata(RATE_LIMITS, handler as object) as RateLimitRule[]).map(
    (r) => r.name,
  );
};

describe('login rate-limit rules (AUTH-09)', () => {
  // The guard stops at the first blocking rule. With the IP rule first, a client already over its
  // IP budget never creates identifier keys, so it can't fill the limiter's key map and lock other
  // users' first attempts out (security review finding N-1).
  it.each(['studentLogin', 'staffLogin'] as const)(
    '%s checks the IP rule before the identifier rule',
    (method) => {
      expect(rulesOf(method)).toEqual(['login-ip', 'login-id']);
    },
  );
});
