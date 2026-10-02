import { Logger } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ReadinessRegistry } from './readiness';

describe('ReadinessRegistry', () => {
  beforeAll(() => Logger.overrideLogger(false));
  afterAll(() => Logger.overrideLogger(['log', 'error', 'warn', 'debug', 'verbose', 'fatal']));

  it('is ready with no checks', async () => {
    expect(await new ReadinessRegistry().run()).toEqual({ ready: true, checks: {} });
  });

  it('aggregates: any failure makes it unready', async () => {
    const r = new ReadinessRegistry();
    r.register({ name: 'database', check: () => Promise.resolve() });
    r.register({ name: 'valkey', check: () => Promise.reject(new Error('down')) });
    expect(await r.run()).toEqual({ ready: false, checks: { database: 'ok', valkey: 'fail' } });
  });

  it('treats a hung check as failed after the timeout', async () => {
    const r = new ReadinessRegistry();
    r.timeoutMs = 20;
    r.register({ name: 'slow', check: () => new Promise(() => undefined) });
    expect(await r.run()).toEqual({ ready: false, checks: { slow: 'fail' } });
  });

  it('turns unready while the app shuts down', async () => {
    const r = new ReadinessRegistry();
    r.beforeApplicationShutdown();
    expect((await r.run()).ready).toBe(false);
  });

  it('rejects duplicate or unsafe names', () => {
    const r = new ReadinessRegistry();
    r.register({ name: 'database', check: () => Promise.resolve() });
    expect(() => {
      r.register({ name: 'database', check: () => Promise.resolve() });
    }).toThrow(/already/);
    expect(() => {
      r.register({ name: 'postgres://user:pw@db', check: () => Promise.resolve() });
    }).toThrow();
  });
});
