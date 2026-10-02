import { createHash } from 'node:crypto';
import {
  type CanActivate,
  type ExecutionContext,
  Inject,
  Injectable,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { contextOf, type RequestContext } from '../context/request-context';
import { AppException } from '../errors/app-exception';
import { RATE_LIMITER, type RateLimiter } from './rate-limiter';

export interface RateLimitRule {
  /** Stable rule name, part of the key: `login-phone`, `login-ip`. */
  name: string;
  limit: number;
  windowSec: number;
  /**
   * What is being counted: the client IP, the signed-in user (falls back to IP), or a value
   * taken from the request — e.g. the phone in a login body. Returning null/undefined skips the
   * rule for this request (an invalid phone is left to validation; the IP rule still applies).
   */
  by: 'ip' | 'user' | ((req: Request) => string | null | undefined);
}

const RATE_LIMITS = 'remix:rateLimits';

/**
 * Per-route limits, all of which must pass. AUTH-09 login, for example:
 *
 * ```ts
 * @RateLimit(
 *   { name: 'login-phone', limit: 5, windowSec: 60, by: (req) => phoneFrom(req.body) },
 *   { name: 'login-ip', limit: 20, windowSec: 60, by: 'ip' },
 * )
 * ```
 */
export const RateLimit = (
  ...rules: [RateLimitRule, ...RateLimitRule[]]
): MethodDecorator & ClassDecorator => SetMetadata(RATE_LIMITS, rules);

/**
 * Build the limiter key. Always scoped by tenant (`t:<tenantId>:`, or `t:platform:` / `t:-:`
 * off-tenant) so one institute's traffic never spends another's budget. The counted value is
 * hashed: keys end up in Valkey and must not hold phone numbers or IPs in clear.
 */
export function rateLimitKey(ctx: RequestContext, rule: RateLimitRule, value: string): string {
  const scope = ctx.tenant?.id ?? (ctx.area === 'platform' ? 'platform' : '-');
  const digest = createHash('sha256').update(value).digest('base64url').slice(0, 32);
  return `t:${scope}:rl:${rule.name}:${digest}`;
}

/** Global guard enforcing `@RateLimit` rules; 429 `RATE_LIMITED` with `Retry-After`. */
@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(RATE_LIMITER) private readonly limiter: RateLimiter,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;
    const rules = this.reflector.getAllAndMerge<RateLimitRule[]>(RATE_LIMITS, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!rules.length) return true;

    const req = context.switchToHttp().getRequest<Request>();
    const ctx = contextOf(req);
    if (!ctx) throw new Error('Request context missing — is the context middleware installed?');

    let retryAfter = 0;
    for (const rule of rules) {
      const value = countedValue(rule, req, ctx);
      if (value === null) continue;
      const decision = await this.limiter.consume(
        rateLimitKey(ctx, rule, value),
        rule.limit,
        rule.windowSec,
      );
      if (!decision.allowed) retryAfter = Math.max(retryAfter, decision.resetSec);
    }

    if (retryAfter > 0) {
      throw new AppException('RATE_LIMITED', 429, 'Too many attempts. Try again later.', {
        headers: { 'retry-after': String(retryAfter) },
      });
    }
    return true;
  }
}

function countedValue(rule: RateLimitRule, req: Request, ctx: RequestContext): string | null {
  if (rule.by === 'ip') return `ip:${ctx.clientIp ?? 'unknown'}`;
  if (rule.by === 'user') {
    return ctx.session ? `user:${ctx.session.userId}` : `ip:${ctx.clientIp ?? 'unknown'}`;
  }
  const value = rule.by(req);
  return value ? `v:${value}` : null;
}
