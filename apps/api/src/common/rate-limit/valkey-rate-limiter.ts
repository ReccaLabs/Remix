import type { Redis } from 'ioredis';
import {
  RateLimiterUnavailableError,
  type RateLimitDecision,
  type RateLimiter,
} from './rate-limiter';

/**
 * Fixed window in one atomic step: `INCR`; the first hit of a window sets `PEXPIRE`; a key found
 * without a TTL (a manual `PERSIST`, or a key created by something else) gets one, so a counter
 * can never become permanent. Returns `{count, ttlMs}`.
 */
const CONSUME_SCRIPT = `
local count = redis.call('INCR', KEYS[1])
local ttl = redis.call('PTTL', KEYS[1])
if count == 1 or ttl < 0 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
  ttl = tonumber(ARGV[1])
end
return {count, ttl}
`;

interface WithConsume {
  rlConsume(key: string, windowMs: number): Promise<unknown>;
}

/**
 * Valkey-backed {@link RateLimiter} (C6). Same fixed-window semantics as the in-memory limiter,
 * but shared by every API node, so limits hold when several nodes serve one client.
 *
 * - **Atomic:** the whole check is one Lua script (`EVALSHA`), so concurrent nodes can never
 *   both see `count == limit` and both pass.
 * - **Fixed window** (not sliding): a window starts at a key's first hit and the key expires by
 *   TTL, so memory is bounded by live windows without a sweeper. The known burst of up to 2x
 *   `limit` across a window edge is accepted; the login and OTP limits are sized with it in mind.
 * - **Outage:** a Valkey error throws {@link RateLimiterUnavailableError}. `RateLimitGuard`
 *   fails **closed** (503) for every rule unless the rule opts in with `onOutage: 'allow'`;
 *   auth, OTP and login limits never do. A limiter that silently let everyone through while
 *   Valkey is down would let an attacker pick the moment (SMS-fraud risk T7).
 */
export class ValkeyRateLimiter implements RateLimiter {
  constructor(private readonly client: Redis) {
    this.client.defineCommand('rlConsume', { numberOfKeys: 1, lua: CONSUME_SCRIPT });
  }

  async consume(key: string, limit: number, windowSec: number): Promise<RateLimitDecision> {
    if (!Number.isInteger(limit) || limit < 1 || !Number.isInteger(windowSec) || windowSec < 1) {
      throw new RangeError('limit and windowSec must be positive integers');
    }
    let reply: unknown;
    try {
      reply = await (this.client as unknown as WithConsume).rlConsume(key, windowSec * 1000);
    } catch (error) {
      throw new RateLimiterUnavailableError(error);
    }
    if (!Array.isArray(reply) || typeof reply[0] !== 'number' || typeof reply[1] !== 'number') {
      throw new RateLimiterUnavailableError(new Error('Unexpected reply from rate limit script'));
    }
    const [count, ttlMs] = reply as [number, number];
    return {
      allowed: count <= limit,
      limit,
      remaining: Math.max(0, limit - count),
      resetSec: Math.max(1, Math.ceil(ttlMs / 1000)),
    };
  }
}
