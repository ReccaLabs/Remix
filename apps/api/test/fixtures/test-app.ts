import { Writable } from 'node:stream';
import { Module, type Type } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import type { Server } from 'node:http';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/bootstrap';
import { SESSION_AUTHENTICATOR } from '../../src/common/auth/session-authenticator';
import { InMemoryRateLimiter, RATE_LIMITER } from '../../src/common/rate-limit/rate-limiter';
import {
  InMemorySessionAuthenticator,
  InMemoryTenantResolver,
} from '../../src/common/testing/in-memory-doubles';
import { TENANT_RESOLVER, type ResolvedTenant } from '../../src/common/tenant/tenant-resolver';
import { loadConfig } from '../../src/config/config';
import { TestController } from './test.controller';

export const TENANT_A: ResolvedTenant = {
  id: '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b',
  slug: 'kamal',
  status: 'active',
};
export const TENANT_B: ResolvedTenant = {
  id: '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5c',
  slug: 'royal',
  status: 'active',
};
export const HOST_A = 'kamal.remix.lk';
export const HOST_B = 'royal.remix.lk';
export const PLATFORM_HOST = 'admin.remix.lk';

/** Collects pino's JSON lines. */
export class LogCapture extends Writable {
  readonly lines: Record<string, unknown>[] = [];

  override _write(chunk: Buffer, _enc: BufferEncoding, done: () => void): void {
    for (const line of chunk.toString('utf8').split('\n')) {
      if (line.trim()) this.lines.push(JSON.parse(line) as Record<string, unknown>);
    }
    done();
  }

  get text(): string {
    return this.lines.map((l) => JSON.stringify(l)).join('\n');
  }
}

export interface TestApp {
  app: NestExpressApplication;
  server: Server;
  logs: LogCapture;
  tenants: InMemoryTenantResolver;
  sessions: InMemorySessionAuthenticator;
  limiter: InMemoryRateLimiter;
  clock: { now: number };
  close(): Promise<void>;
}

/**
 * Boot the real app (AppModule + configureApp, exactly as main.ts) with in-memory doubles for the
 * extension points and the test controller mounted. No database needed.
 */
export async function createTestApp(
  options: { env?: Record<string, string>; controllers?: Type[] } = {},
): Promise<TestApp> {
  const config = loadConfig({
    NODE_ENV: 'test',
    LOG_LEVEL: 'debug',
    TENANT_BASE_DOMAINS: 'remix.lk',
    PLATFORM_HOSTS: PLATFORM_HOST,
    TRUST_PROXY: 'loopback',
    ...options.env,
  });
  const logs = new LogCapture();
  const tenants = new InMemoryTenantResolver({ [HOST_A]: TENANT_A, [HOST_B]: TENANT_B });
  const sessions = new InMemorySessionAuthenticator();
  const clock = { now: Date.UTC(2026, 9, 1, 8, 0, 0) };
  const limiter = new InMemoryRateLimiter(() => clock.now);

  @Module({ controllers: options.controllers ?? [TestController] })
  class TestFeatureModule {}

  const moduleRef = await Test.createTestingModule({
    imports: [AppModule.forRoot({ config, logDestination: logs }), TestFeatureModule],
  })
    .overrideProvider(TENANT_RESOLVER)
    .useValue(tenants)
    .overrideProvider(SESSION_AUTHENTICATOR)
    .useValue(sessions)
    .overrideProvider(RATE_LIMITER)
    .useValue(limiter)
    .compile();

  const app = moduleRef.createNestApplication<NestExpressApplication>({
    bodyParser: false,
    bufferLogs: true,
  });
  configureApp(app, config);
  await app.init();

  return {
    app,
    server: app.getHttpServer(),
    logs,
    tenants,
    sessions,
    limiter,
    clock,
    close: () => app.close(),
  };
}
