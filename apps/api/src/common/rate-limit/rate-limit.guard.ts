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
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { contextOf, type RequestContext } from '../context/request-context';
import { AppException } from '../errors/app-exception';
import { clientIpKey } from './client-ip-key';
import { RATE_LIMITER, type RateLimiter } from './rate-limiter';

export interface RateLimitRule {
  /** Stable rule name, part of the key: `login-phone`, `login-ip`. */
  name: string;
  limit: number;
  windowSec: number;
  /**
   * What is being counted: the client IP, the signed-in user (falls back to IP), or a value
   * taken from the request — e.g. the phone in a login body. The value must come from the
   * *validated* shape of the input. Returning null/undefined does NOT skip the rule: such
   * requests share one fixed bucket, so a body crafted to defeat the extractor still counts.
   */
  by: 'ip' | 'user' | ((req: Request) => string | null | undefined);
}

const RATE_LIMITS = 'remix:rateLimits';

/**
 * Per-route limits, all of which must pass; the first to block ends the check. AUTH-09 login,
 * for example:
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

/**
 * Global guard enforcing `@RateLimit` rules in order, stopping at the first that blocks; 429
 * `RATE_LIMITED` with `Retry-After`.
 */
@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(RATE_LIMITER) private readonly limiter: RateLimiter,
    @InjectPinoLogger(RateLimitGuard.name) private readonly logger: PinoLogger,
  ) {}

  private warnedNoClientIp = false;

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

    // Rules run in declaration order and stop at the first one that blocks: a request that is
    // already refused must not create or spend the other rules' keys (it would let a blocked
    // caller fill the limiter with junk keys for free).
    for (const rule of rules) {
      const value = countedValue(rule, req, ctx);
      if (value === null) {
        // Only the IP rules get here: with no client address there is nothing honest to count
        // (a shared "unknown" key would merge every such client into one budget and lock them
        // all out together). The other rules, keyed by what the request carries, still apply.
        this.warnNoClientIp();
        continue;
      }
      const decision = await this.limiter.consume(
        rateLimitKey(ctx, rule, value),
        rule.limit,
        rule.windowSec,
      );
      if (!decision.allowed) {
        throw new AppException('RATE_LIMITED', 429, 'Too many attempts. Try again later.', {
          headers: { 'retry-after': String(decision.resetSec) },
        });
      }
    }
    return true;
  }

  /** Once per process: this is a deployment problem (TRUST_PROXY / edge proxy), not per request. */
  private warnNoClientIp(): void {
    if (this.warnedNoClientIp) return;
    this.warnedNoClientIp = true;
    this.logger.warn(
      'Client IP could not be determined: per-IP rate limits are skipped for these requests. Check the edge proxy and TRUST_PROXY.',
    );
  }
}

/** The client, as the limiter counts it: IPv6 by /64, IPv4-mapped IPv6 as IPv4 (S-03). */
const ipValue = (ctx: RequestContext): string | null =>
  ctx.clientIp ? `ip:${clientIpKey(ctx.clientIp)}` : null;

/** Counted value for a request whose extractor produced nothing usable (shared bucket). */
const UNKEYED_VALUE = 'unkeyed';

/** The value to count, or null to skip the rule (only IP rules, and only without a client IP). */
function countedValue(rule: RateLimitRule, req: Request, ctx: RequestContext): string | null {
  if (rule.by === 'ip') return ipValue(ctx);
  if (rule.by === 'user') return ctx.session ? `user:${ctx.session.userId}` : ipValue(ctx);
  // Never skip: an unusable value goes to one fixed bucket (no `v:` prefix, so it cannot collide
  // with a real value), so the rule cannot be bypassed by making the extractor return nothing.
  const value = rule.by(req);
  return value ? `v:${value}` : UNKEYED_VALUE;
}
