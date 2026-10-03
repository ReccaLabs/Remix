import type { ExecutionContext } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import type { PinoLogger } from 'nestjs-pino';
import { describe, expect, it, vi } from 'vitest';
import { attachContext, createRequestContext } from '../context/request-context';
import { RateLimitGuard, type RateLimitRule } from './rate-limit.guard';
import { RateLimiterUnavailableError } from './rate-limiter';

const TENANT = {
  id: '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b',
  slug: 'kamal',
  status: 'active',
} as const;

function downGuard(rules: RateLimitRule[], error: Error = new RateLimiterUnavailableError('down')) {
  const warn = vi.fn();
  const errorLog = vi.fn();
  const guard = new RateLimitGuard(
    { getAllAndMerge: () => rules } as unknown as Reflector,
    { consume: () => Promise.reject(error) },
    { warn, error: errorLog } as unknown as PinoLogger,
  );
  return { guard, warn, errorLog };
}

function contextFor(guard: RateLimitGuard): ExecutionContext {
  const req = {} as Request;
  const ctx = createRequestContext({
    requestId: 'r',
    host: 'kamal.remix.lk',
    protocol: 'https',
    origin: 'https://kamal.remix.lk',
    clientIp: '203.0.113.7',
  });
  ctx.tenant = TENANT;
  attachContext(req, ctx);
  return {
    getType: () => 'http',
    getHandler: () => guard,
    getClass: () => RateLimitGuard,
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
}

describe('RateLimitGuard when the limiter backend is down (C6)', () => {
  it('fails closed by default: 503 with Retry-After, request refused', async () => {
    const { guard, errorLog } = downGuard([{ name: 'otp', limit: 3, windowSec: 900, by: 'ip' }]);
    await expect(guard.canActivate(contextFor(guard))).rejects.toMatchObject({
      status: 503,
      code: 'INTERNAL',
      headers: { 'retry-after': '5' },
    });
    expect(errorLog).toHaveBeenCalled();
  });

  it('skips a rule that opted in with onOutage: allow, still enforcing the others', async () => {
    const soft = downGuard([
      { name: 'soft', limit: 3, windowSec: 60, by: 'ip', onOutage: 'allow' },
    ]);
    await expect(soft.guard.canActivate(contextFor(soft.guard))).resolves.toBe(true);
    expect(soft.warn).toHaveBeenCalled();

    const mixed = downGuard([
      { name: 'soft', limit: 3, windowSec: 60, by: 'ip', onOutage: 'allow' },
      { name: 'otp', limit: 3, windowSec: 900, by: 'ip' },
    ]);
    await expect(mixed.guard.canActivate(contextFor(mixed.guard))).rejects.toMatchObject({
      status: 503,
    });
  });

  it('does not swallow other limiter errors', async () => {
    const { guard } = downGuard(
      [{ name: 'x', limit: 1, windowSec: 60, by: 'ip' }],
      new RangeError('bad'),
    );
    await expect(guard.canActivate(contextFor(guard))).rejects.toBeInstanceOf(RangeError);
  });
});
