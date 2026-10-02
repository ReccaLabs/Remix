import type { ExecutionContext } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import type { PinoLogger } from 'nestjs-pino';
import { describe, expect, it, vi } from 'vitest';
import { attachContext, createRequestContext } from '../context/request-context';
import { AppException } from '../errors/app-exception';
import { RateLimitGuard, type RateLimitRule } from './rate-limit.guard';
import { InMemoryRateLimiter } from './rate-limiter';

const TENANT = {
  id: '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b',
  slug: 'kamal',
  status: 'active',
} as const;

function setup(rules: RateLimitRule[], clientIp: string | null = '203.0.113.7') {
  const clock = { now: 1_000_000 };
  const limiter = new InMemoryRateLimiter(() => clock.now, 100);
  const consumed: string[] = [];
  const spy = {
    consume: (key: string, limit: number, windowSec: number) => {
      consumed.push(key);
      return limiter.consume(key, limit, windowSec);
    },
  };
  const reflector = { getAllAndMerge: () => rules } as unknown as Reflector;
  const warn = vi.fn();
  const guard = new RateLimitGuard(reflector, spy, { warn } as unknown as PinoLogger);

  const run = (body: unknown = {}) => {
    const req = { body } as Request;
    const ctx = createRequestContext({
      requestId: 'r',
      host: 'kamal.remix.lk',
      protocol: 'https',
      origin: 'https://kamal.remix.lk',
      clientIp,
    });
    ctx.tenant = TENANT;
    attachContext(req, ctx);
    const context = {
      getType: () => 'http',
      getHandler: () => run,
      getClass: () => RateLimitGuard,
      switchToHttp: () => ({ getRequest: () => req }),
    } as unknown as ExecutionContext;
    return guard.canActivate(context);
  };
  return { limiter, consumed, run, warn };
}

describe('RateLimitGuard', () => {
  it('stops at the first blocking rule and does not consume the later ones (S-04)', async () => {
    const { limiter, consumed, run } = setup([
      { name: 'by-id', limit: 1, windowSec: 60, by: () => 'victim' },
      { name: 'by-ip', limit: 100, windowSec: 60, by: 'ip' },
    ]);
    await run();
    expect(consumed).toHaveLength(2);
    await expect(run()).rejects.toMatchObject({ status: 429 });
    // The blocked call touched only the first rule's key.
    expect(consumed).toHaveLength(3);
    expect(consumed[2]).toBe(consumed[0]);
    expect(limiter.keys()).toHaveLength(2);
  });

  it("reports the blocking rule's Retry-After", async () => {
    const { run } = setup([{ name: 'r', limit: 1, windowSec: 45, by: 'ip' }]);
    await run();
    const error = await run().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AppException);
    expect((error as AppException).headers).toEqual({ 'retry-after': '45' });
  });

  it('does not skip a keyed rule when the extractor returns nothing (S-01)', async () => {
    const { consumed, run } = setup([
      { name: 'id', limit: 2, windowSec: 60, by: () => null },
      { name: 'ip', limit: 100, windowSec: 60, by: 'ip' },
    ]);
    await run();
    await run();
    await expect(run()).rejects.toMatchObject({ status: 429 });
    // Rule `id` was counted on every call, in one shared bucket.
    const idKeys = consumed.filter((_, i) => i === 0 || i === 2 || i === 4);
    expect(new Set(idKeys).size).toBe(1);
  });

  describe('without a client IP (S-07)', () => {
    it('skips only the IP rule: the identifier rule still counts, and nobody shares a bucket', async () => {
      const { consumed, run, warn } = setup(
        [
          { name: 'id', limit: 2, windowSec: 60, by: (req) => (req.body as { id: string }).id },
          { name: 'ip', limit: 1, windowSec: 60, by: 'ip' },
        ],
        null,
      );
      // Two different clients with no IP: the IP rule must not lock the second out ...
      await run({ id: 'a' });
      await run({ id: 'b' });
      await run({ id: 'c' });
      expect(consumed).toHaveLength(3); // ... only the id rule ran, once per request
      // ... while the identifier rule still limits one account.
      await run({ id: 'a' });
      await expect(run({ id: 'a' })).rejects.toMatchObject({ status: 429 });
      expect(warn).toHaveBeenCalledTimes(1); // logged once, not per request
    });

    it('skips a "user" rule for an anonymous request without an IP, but keys a signed-in user', async () => {
      const { consumed, run } = setup([{ name: 'u', limit: 1, windowSec: 60, by: 'user' }], null);
      await run();
      await run();
      expect(consumed).toHaveLength(0);
    });

    it('does not warn when the client IP is known', async () => {
      const { run, warn } = setup([{ name: 'ip', limit: 5, windowSec: 60, by: 'ip' }]);
      await run();
      expect(warn).not.toHaveBeenCalled();
    });
  });
});
