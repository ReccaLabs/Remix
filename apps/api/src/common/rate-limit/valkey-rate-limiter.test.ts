import type { Redis } from 'ioredis';
import { describe, expect, it, vi } from 'vitest';
import { RateLimiterUnavailableError } from './rate-limiter';
import { ValkeyRateLimiter } from './valkey-rate-limiter';

/** Stub only for client-failure shapes; atomicity is tested against real Valkey (test/valkey). */
function stubClient(rlConsume: (key: string, windowMs: number) => Promise<unknown>) {
  const defineCommand = vi.fn();
  return { client: { defineCommand, rlConsume } as unknown as Redis, defineCommand };
}

describe('ValkeyRateLimiter (client failure handling)', () => {
  it('registers one Lua command and maps its reply to a decision', async () => {
    const rlConsume = vi.fn().mockResolvedValue([2, 59_100]);
    const { client, defineCommand } = stubClient(rlConsume);
    const limiter = new ValkeyRateLimiter(client);
    expect(defineCommand).toHaveBeenCalledWith(
      'rlConsume',
      expect.objectContaining({ numberOfKeys: 1 }),
    );
    expect(await limiter.consume('k', 3, 60)).toEqual({
      allowed: true,
      limit: 3,
      remaining: 1,
      resetSec: 60,
    });
    expect(rlConsume).toHaveBeenCalledWith('k', 60_000);
  });

  it('blocks when the count passes the limit', async () => {
    const { client } = stubClient(() => Promise.resolve([4, 1000]));
    expect(await new ValkeyRateLimiter(client).consume('k', 3, 60)).toMatchObject({
      allowed: false,
      remaining: 0,
      resetSec: 1,
    });
  });

  it('turns a client error into RateLimiterUnavailableError (fail-closed signal)', async () => {
    const { client } = stubClient(() => Promise.reject(new Error('ECONNREFUSED')));
    await expect(new ValkeyRateLimiter(client).consume('k', 3, 60)).rejects.toBeInstanceOf(
      RateLimiterUnavailableError,
    );
  });

  it('treats an unexpected script reply as unavailable', async () => {
    const { client } = stubClient(() => Promise.resolve('OK'));
    await expect(new ValkeyRateLimiter(client).consume('k', 3, 60)).rejects.toBeInstanceOf(
      RateLimiterUnavailableError,
    );
  });

  it.each([
    [0, 60],
    [1.5, 60],
    [3, 0],
    [3, -1],
  ])('rejects limit=%s windowSec=%s', async (limit, windowSec) => {
    const { client } = stubClient(() => Promise.resolve([1, 1000]));
    await expect(new ValkeyRateLimiter(client).consume('k', limit, windowSec)).rejects.toThrow(
      RangeError,
    );
  });
});
