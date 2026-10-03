export interface RateLimitDecision {
  allowed: boolean;
  limit: number;
  /** Requests left in the current window (0 when blocked). */
  remaining: number;
  /** Seconds until the window resets; what `Retry-After` carries when blocked. */
  resetSec: number;
}

/**
 * Fixed-window counter. `consume` counts one hit against `key` and says whether it is within
 * `limit` per `windowSec`. Keys are built by the rate-limit guard and always start with
 * `t:<tenantId>:` (cache-key rule, 03-architecture §3).
 *
 * Production uses `ValkeyRateLimiter` (shared across API nodes). {@link InMemoryRateLimiter}
 * is for unit tests and for development without `VALKEY_URL`; it is per process and must not
 * be used where more than one API node serves traffic.
 */
export interface RateLimiter {
  consume(key: string, limit: number, windowSec: number): Promise<RateLimitDecision>;
}

/** Thrown when the limiter backend (Valkey) cannot answer. The guard decides, per rule, to fail closed or open. */
export class RateLimiterUnavailableError extends Error {
  constructor(cause: unknown) {
    super('Rate limiter backend unavailable', { cause });
    this.name = 'RateLimiterUnavailableError';
  }
}

/** DI token for {@link RateLimiter}. */
export const RATE_LIMITER = Symbol('RateLimiter');

interface Window {
  count: number;
  resetAt: number;
}

/**
 * Single-process limiter for dev, tests and the first deploy. Memory is bounded by `maxKeys`,
 * and the bound cannot be turned against other clients:
 * - expired windows are swept at most once per `sweepIntervalMs` (not per call, so a full map
 *   costs one pass a second instead of one per request);
 * - a live window is never evicted — least of all one that is at or over its limit — because
 *   flushing a victim's counter by creating junk keys would hand an attacker fresh attempts;
 * - when the map is still full, a *new* key fails closed (the request is rate limited) while
 *   existing keys keep counting. Legitimate new keys wait at most until the next sweep or the
 *   end of a window (the Valkey limiter is TTL-based and has no such bound).
 */
export class InMemoryRateLimiter implements RateLimiter {
  private readonly windows = new Map<string, Window>();
  private lastSweepAt = Number.NEGATIVE_INFINITY;
  /** Sweeps run so far (tests and diagnostics). */
  sweeps = 0;

  constructor(
    private readonly now: () => number = Date.now,
    private readonly maxKeys = 100_000,
    private readonly sweepIntervalMs = 1000,
  ) {}

  consume(key: string, limit: number, windowSec: number): Promise<RateLimitDecision> {
    if (!Number.isInteger(limit) || limit < 1 || !Number.isInteger(windowSec) || windowSec < 1) {
      return Promise.reject(new RangeError('limit and windowSec must be positive integers'));
    }
    const now = this.now();
    if (now - this.lastSweepAt >= this.sweepIntervalMs) this.sweep(now);

    let window = this.windows.get(key);
    if (!window && this.windows.size >= this.maxKeys) {
      // Full of live windows: refuse the newcomer, never evict someone else's counter.
      return Promise.resolve({
        allowed: false,
        limit,
        remaining: 0,
        resetSec: Math.max(1, Math.ceil(this.sweepIntervalMs / 1000)),
      });
    }
    if (!window || window.resetAt <= now) {
      window = { count: 0, resetAt: now + windowSec * 1000 };
      this.windows.set(key, window);
    }
    window.count += 1;

    const allowed = window.count <= limit;
    return Promise.resolve({
      allowed,
      limit,
      remaining: Math.max(0, limit - window.count),
      resetSec: Math.max(1, Math.ceil((window.resetAt - now) / 1000)),
    });
  }

  /** Keys of live windows (tests and diagnostics). */
  keys(): string[] {
    return [...this.windows.keys()];
  }

  private sweep(now: number): void {
    this.lastSweepAt = now;
    this.sweeps += 1;
    for (const [key, window] of this.windows) if (window.resetAt <= now) this.windows.delete(key);
  }
}
