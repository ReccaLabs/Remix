import { Redis } from 'ioredis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RateLimiterUnavailableError } from '../../src/common/rate-limit/rate-limiter';
import { ValkeyRateLimiter } from '../../src/common/rate-limit/valkey-rate-limiter';
import { createValkeyClient, waitUntilReady } from '../../src/common/valkey/valkey';
import { deleteByPrefix, reachable, uniqueName, VALKEY_URL } from './support';

// Real Valkey on purpose: the point is that INCR+PEXPIRE is atomic across connections.
describe.skipIf(!reachable)('ValkeyRateLimiter (real Valkey)', () => {
  const ns = uniqueName('rl');
  let nodeA: Redis;
  let nodeB: Redis;
  let admin: Redis;

  beforeAll(async () => {
    // Two clients = two API nodes sharing one Valkey.
    nodeA = createValkeyClient(VALKEY_URL);
    nodeB = createValkeyClient(VALKEY_URL);
    admin = createValkeyClient(VALKEY_URL);
    for (const c of [nodeA, nodeB, admin]) expect(await waitUntilReady(c, 5000)).toBe(true);
  });

  afterAll(async () => {
    await deleteByPrefix(admin, ns);
    nodeA.disconnect();
    nodeB.disconnect();
    admin.disconnect();
  });

  it('counts hits, blocks over the limit and reports remaining / reset', async () => {
    const limiter = new ValkeyRateLimiter(nodeA);
    const key = `${ns}:basic`;
    const decisions = [];
    for (let i = 0; i < 4; i += 1) decisions.push(await limiter.consume(key, 3, 60));
    expect(decisions.map((d) => d.allowed)).toEqual([true, true, true, false]);
    expect(decisions.map((d) => d.remaining)).toEqual([2, 1, 0, 0]);
    expect(decisions[3]?.limit).toBe(3);
    expect(decisions[3]?.resetSec).toBeGreaterThan(55);
    expect(decisions[3]?.resetSec).toBeLessThanOrEqual(60);
  });

  it('is atomic: concurrent hits from two nodes never exceed the limit', async () => {
    const a = new ValkeyRateLimiter(nodeA);
    const b = new ValkeyRateLimiter(nodeB);
    const key = `${ns}:atomic`;
    const results = await Promise.all(
      Array.from({ length: 200 }, (_, i) => (i % 2 ? a : b).consume(key, 25, 60)),
    );
    expect(results.filter((r) => r.allowed)).toHaveLength(25);
    expect(results.filter((r) => !r.allowed)).toHaveLength(175);
    // Remaining is never negative and every allowed hit saw a distinct count.
    expect(new Set(results.filter((r) => r.allowed).map((r) => r.remaining)).size).toBe(25);
  });

  it('expires the window by TTL and starts a fresh one', async () => {
    const limiter = new ValkeyRateLimiter(nodeA);
    const key = `${ns}:expiry`;
    expect((await limiter.consume(key, 1, 1)).allowed).toBe(true);
    expect((await limiter.consume(key, 1, 1)).allowed).toBe(false);
    expect(await admin.pttl(key)).toBeGreaterThan(0);
    await new Promise((resolve) => setTimeout(resolve, 1200));
    expect((await limiter.consume(key, 1, 1)).allowed).toBe(true);
  });

  it('gives a key that lost its TTL a new one (a counter can never become permanent)', async () => {
    const limiter = new ValkeyRateLimiter(nodeA);
    const key = `${ns}:persist`;
    await limiter.consume(key, 5, 30);
    await admin.persist(key);
    expect(await admin.pttl(key)).toBe(-1);
    await limiter.consume(key, 5, 30);
    const ttl = await admin.pttl(key);
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(30_000);
  });

  it('keeps keys independent and does not move the window on later hits', async () => {
    const limiter = new ValkeyRateLimiter(nodeA);
    await limiter.consume(`${ns}:k1`, 1, 60);
    expect((await limiter.consume(`${ns}:k2`, 1, 60)).allowed).toBe(true);
    const before = await admin.pttl(`${ns}:k1`);
    await limiter.consume(`${ns}:k1`, 1, 60);
    expect(await admin.pttl(`${ns}:k1`)).toBeLessThanOrEqual(before);
  });

  it('throws RateLimiterUnavailableError (fail-closed signal) when Valkey is down', async () => {
    const dead = createValkeyClient(VALKEY_URL);
    await new Promise((resolve) => dead.once('ready', resolve));
    dead.disconnect();
    const limiter = new ValkeyRateLimiter(dead);
    await expect(limiter.consume(`${ns}:down`, 1, 60)).rejects.toBeInstanceOf(
      RateLimiterUnavailableError,
    );
  });
});
