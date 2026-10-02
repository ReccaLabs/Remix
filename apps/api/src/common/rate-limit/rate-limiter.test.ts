import { describe, expect, it } from 'vitest';
import { createRequestContext } from '../context/request-context';
import { rateLimitKey } from './rate-limit.guard';
import { InMemoryRateLimiter } from './rate-limiter';

describe('InMemoryRateLimiter', () => {
  const setup = () => {
    const clock = { now: 1_000_000 };
    return { clock, limiter: new InMemoryRateLimiter(() => clock.now, 10) };
  };

  it('allows up to the limit, then blocks until the window resets', async () => {
    const { clock, limiter } = setup();
    expect(await limiter.consume('k', 2, 60)).toEqual({
      allowed: true,
      limit: 2,
      remaining: 1,
      resetSec: 60,
    });
    expect((await limiter.consume('k', 2, 60)).remaining).toBe(0);
    expect(await limiter.consume('k', 2, 60)).toMatchObject({
      allowed: false,
      remaining: 0,
      resetSec: 60,
    });

    clock.now += 59_500;
    expect(await limiter.consume('k', 2, 60)).toMatchObject({ allowed: false, resetSec: 1 });

    clock.now += 500;
    expect(await limiter.consume('k', 2, 60)).toMatchObject({
      allowed: true,
      remaining: 1,
      resetSec: 60,
    });
  });

  it('keeps keys independent', async () => {
    const { limiter } = setup();
    await limiter.consume('a', 1, 60);
    expect((await limiter.consume('a', 1, 60)).allowed).toBe(false);
    expect((await limiter.consume('b', 1, 60)).allowed).toBe(true);
  });

  it('stays bounded: expired windows are swept, live ones are kept', async () => {
    const { clock, limiter } = setup();
    for (let i = 0; i < 10; i++) await limiter.consume(`old-${i}`, 5, 1);
    clock.now += 2000;
    await limiter.consume('fresh', 5, 60);
    expect(limiter.keys()).toEqual(['fresh']);
  });

  describe('at capacity (S-04)', () => {
    const fill = async (limiter: InMemoryRateLimiter, count: number, limit = 5, windowSec = 60) => {
      for (let i = 0; i < count; i++) await limiter.consume(`live-${i}`, limit, windowSec);
    };

    it('sweeps at most once per interval, not on every call', async () => {
      const { clock, limiter } = setup();
      await fill(limiter, 10);
      const before = limiter.sweeps;
      // 500 calls at capacity within the same second: the map is full of live windows.
      for (let i = 0; i < 500; i++) await limiter.consume(`new-${i}`, 5, 60);
      expect(limiter.sweeps - before).toBeLessThanOrEqual(1);

      clock.now += 999;
      for (let i = 0; i < 100; i++) await limiter.consume(`new-${i}`, 5, 60);
      const midway = limiter.sweeps;
      clock.now += 1;
      await limiter.consume('again', 5, 60);
      expect(limiter.sweeps).toBe(midway + 1);
    });

    it('evicts expired windows first: a map of dead windows costs a new key nothing', async () => {
      const { clock, limiter } = setup();
      await fill(limiter, 10, 5, 1);
      clock.now += 1500;
      expect((await limiter.consume('newcomer', 5, 60)).allowed).toBe(true);
      expect(limiter.keys()).toEqual(['newcomer']);
    });

    it('never evicts a live window: a blocked key stays blocked while junk keys pour in', async () => {
      const { limiter } = setup();
      for (let i = 0; i < 4; i++) await limiter.consume('victim', 3, 60);
      expect((await limiter.consume('victim', 3, 60)).allowed).toBe(false);
      await fill(limiter, 9, 3); // the map is now full
      expect(limiter.keys()).toHaveLength(10);

      // An attacker tries to flush the victim's counter with thousands of fresh keys.
      for (let i = 0; i < 2000; i++) await limiter.consume(`junk-${i}`, 3, 60);
      expect(limiter.keys()).toContain('victim');
      expect(limiter.keys()).toHaveLength(10);
      expect((await limiter.consume('victim', 3, 60)).allowed).toBe(false);
    });

    it('also keeps live windows that are under their limit (their counter cannot be reset)', async () => {
      const { limiter } = setup();
      await limiter.consume('half-spent', 5, 60);
      await fill(limiter, 9);
      for (let i = 0; i < 100; i++) await limiter.consume(`junk-${i}`, 5, 60);
      expect(limiter.keys()).toContain('half-spent');
      expect((await limiter.consume('half-spent', 5, 60)).remaining).toBe(3);
    });

    it('fails closed for a new key when the map is full of live windows', async () => {
      const { limiter } = setup();
      await fill(limiter, 10);
      expect(await limiter.consume('newcomer', 5, 60)).toEqual({
        allowed: false,
        limit: 5,
        remaining: 0,
        resetSec: 1,
      });
      expect(limiter.keys()).not.toContain('newcomer');
      // Existing keys keep working normally.
      expect(await limiter.consume('live-3', 5, 60)).toMatchObject({ allowed: true, remaining: 3 });
    });

    it('lets new keys in again once windows expire', async () => {
      const { clock, limiter } = setup();
      await fill(limiter, 10, 5, 60);
      expect((await limiter.consume('newcomer', 5, 60)).allowed).toBe(false);
      clock.now += 60_000;
      expect((await limiter.consume('newcomer', 5, 60)).allowed).toBe(true);
    });
  });

  it.each([
    [0, 60],
    [1.5, 60],
    [5, 0],
    [5, -1],
  ])('rejects limit=%s windowSec=%s', async (limit, windowSec) => {
    await expect(setup().limiter.consume('k', limit, windowSec)).rejects.toThrow(RangeError);
  });
});

describe('rateLimitKey', () => {
  const ctx = createRequestContext({
    requestId: 'r',
    host: 'kamal.remix.lk',
    protocol: 'https',
    origin: 'https://kamal.remix.lk',
    clientIp: '203.0.113.7',
  });
  const rule = { name: 'login-phone', limit: 5, windowSec: 60, by: 'ip' as const };

  it('is scoped by tenant and hashes the counted value', () => {
    ctx.tenant = { id: '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b', slug: 'kamal', status: 'active' };
    const key = rateLimitKey(ctx, rule, 'v:+94771234567');
    expect(key).toMatch(/^t:0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b:rl:login-phone:[\w-]{32}$/);
    expect(key).not.toContain('9477');
  });

  it('differs per tenant for the same value', () => {
    ctx.tenant = { id: '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b', slug: 'kamal', status: 'active' };
    const a = rateLimitKey(ctx, rule, 'ip:1');
    ctx.tenant = { id: '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5c', slug: 'royal', status: 'active' };
    expect(rateLimitKey(ctx, rule, 'ip:1')).not.toBe(a);
  });

  it('uses explicit scopes off-tenant', () => {
    ctx.tenant = null;
    ctx.area = 'platform';
    expect(rateLimitKey(ctx, rule, 'x')).toMatch(/^t:platform:/);
    ctx.area = null;
    expect(rateLimitKey(ctx, rule, 'x')).toMatch(/^t:-:/);
  });
});
