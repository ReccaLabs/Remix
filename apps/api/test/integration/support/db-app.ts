import { randomBytes } from 'node:crypto';
import type { Server } from 'node:http';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { and, eq, sql } from 'drizzle-orm';
import request from 'supertest';
import { inject } from 'vitest';
import { createOwnerDb, hashPassword, schema, type Db } from '@remix/db';
import type { StaffRole, TenantStatus } from '@remix/types/api';
import { AppModule } from '../../../src/app.module';
import { configureApp } from '../../../src/bootstrap';
import { InMemoryRateLimiter, RATE_LIMITER } from '../../../src/common/rate-limit/rate-limiter';
import { CLOCK, ManualClock } from '../../../src/common/time/clock';
import { loadConfig } from '../../../src/config/config';
import { TENANT_CACHE } from '../../../src/modules/tenancy/db-tenant-resolver';
import type { InMemoryTenantCache } from '../../../src/modules/tenancy/tenant-cache';
import { LogCapture } from '../../fixtures/test-app';

export const BASE_DOMAIN = 'remix.lk';
/** 10:00 in Colombo on 15 October 2026. */
export const START = new Date('2026-10-15T04:30:00Z');
export const PASSWORD = 'correct horse battery';

export interface DbTestApp {
  app: NestExpressApplication;
  server: Server;
  clock: ManualClock;
  limiter: InMemoryRateLimiter;
  tenantCache: InMemoryTenantCache;
  logs: LogCapture;
  close(): Promise<void>;
}

/**
 * The real API (AppModule with the database modules, configureApp exactly as main.ts) against
 * the Testcontainers Postgres, connected as `remix_app`. Only the clock and the limiter are
 * swapped for controllable instances.
 */
export async function createDbTestApp(env: Record<string, string> = {}): Promise<DbTestApp> {
  const urls = inject('dbUrls');
  const config = loadConfig(
    {
      NODE_ENV: 'test',
      LOG_LEVEL: 'info',
      TENANT_BASE_DOMAINS: BASE_DOMAIN,
      PLATFORM_HOSTS: `admin.${BASE_DOMAIN}`,
      TRUST_PROXY: 'loopback',
      COOKIE_SECURE: 'false',
      DATABASE_URL: urls.app,
      ...env,
    },
    { requireDatabase: true },
  );
  const logs = new LogCapture();
  const clock = new ManualClock(START);
  const limiter = new InMemoryRateLimiter(() => clock.nowMs());
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule.forRoot({ config, logDestination: logs })],
  })
    .overrideProvider(CLOCK)
    .useValue(clock)
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
    clock,
    limiter,
    tenantCache: app.get<InMemoryTenantCache>(TENANT_CACHE),
    logs,
    close: () => app.close(),
  };
}

/** Owner-role pool for arranging data (bypasses RLS — tests only, like the seed). */
export function ownerDb(): Db {
  return createOwnerDb(inject('dbUrls').owner, { max: 2 });
}

const tag = () => randomBytes(3).toString('hex');
let phoneCounter = 0;
/** A unique, valid Sri Lankan mobile per call (per test file process). */
export function uniquePhone(): string {
  phoneCounter += 1;
  const n =
    (Number.parseInt(randomBytes(2).toString('hex'), 16) * 1000 + phoneCounter) % 10_000_000;
  return `+9476${String(n).padStart(7, '0')}`;
}

export interface TenantFixture {
  id: string;
  slug: string;
  host: string;
}

export interface UserFixture {
  id: string;
  phone: string;
  email: string | null;
}

/** Small factories: one tenant, a few users and classes — never the 2,000-student seed. */
export class Factory {
  private passwordHash: Promise<string> | undefined;

  constructor(readonly db: Db) {}

  hash(): Promise<string> {
    this.passwordHash ??= hashPassword(PASSWORD);
    return this.passwordHash;
  }

  async tenant(status: TenantStatus = 'active'): Promise<TenantFixture> {
    const slug = `t-${tag()}`;
    const [row] = await this.db
      .insert(schema.tenants)
      .values({ slug, name: `Test ${slug}`, plan: 'institute', status, studentNoPrefix: 'TT' })
      .returning({ id: schema.tenants.id });
    if (!row) throw new Error('tenant not created');
    return { id: row.id, slug, host: `${slug}.${BASE_DOMAIN}` };
  }

  async student(
    tenant: TenantFixture,
    opts: {
      phone?: string;
      status?: 'active' | 'disabled';
      archived?: boolean;
      name?: string;
      passwordHash?: string;
    } = {},
  ): Promise<UserFixture> {
    const phone = opts.phone ?? uniquePhone();
    const [user] = await this.db
      .insert(schema.tenantUsers)
      .values({
        tenantId: tenant.id,
        kind: 'student',
        phone,
        displayName: opts.name ?? 'Nimali Perera',
        passwordHash: opts.passwordHash ?? (await this.hash()),
        status: opts.status ?? 'active',
      })
      .returning({ id: schema.tenantUsers.id });
    if (!user) throw new Error('student not created');
    await this.db.insert(schema.students).values({
      tenantId: tenant.id,
      userId: user.id,
      studentNo: `TT-${tag()}`,
      archivedAt: opts.archived ? START : null,
    });
    return { id: user.id, phone, email: null };
  }

  async staff(
    tenant: TenantFixture,
    roles: StaffRole[],
    opts: { email?: string; status?: 'active' | 'disabled'; name?: string } = {},
  ): Promise<UserFixture> {
    const phone = uniquePhone();
    const email = opts.email ?? `staff-${tag()}@example.test`;
    const [user] = await this.db
      .insert(schema.tenantUsers)
      .values({
        tenantId: tenant.id,
        kind: 'staff',
        phone,
        email,
        displayName: opts.name ?? 'Kamal Jayasinghe',
        passwordHash: await this.hash(),
        status: opts.status ?? 'active',
      })
      .returning({ id: schema.tenantUsers.id });
    if (!user) throw new Error('staff not created');
    if (roles.length) {
      await this.db
        .insert(schema.staffRoles)
        .values(roles.map((role) => ({ tenantId: tenant.id, userId: user.id, role })));
    }
    return { id: user.id, phone, email };
  }

  async klass(
    tenant: TenantFixture,
    opts: {
      name: string;
      feeCents: number;
      teacherId?: string | null;
      archived?: boolean;
      schedules?: Array<[number, string, number]>;
    },
  ): Promise<string> {
    const [row] = await this.db
      .insert(schema.classes)
      .values({
        tenantId: tenant.id,
        name: opts.name,
        grade: '2027 A/L',
        medium: 'sinhala',
        teacherId: opts.teacherId ?? null,
        feeCents: opts.feeCents,
        place: 'hall',
        archivedAt: opts.archived ? START : null,
      })
      .returning({ id: schema.classes.id });
    if (!row) throw new Error('class not created');
    if (opts.schedules?.length) {
      await this.db.insert(schema.classSchedules).values(
        opts.schedules.map(([weekday, startTime, durationMinutes]) => ({
          tenantId: tenant.id,
          classId: row.id,
          weekday,
          startTime,
          durationMinutes,
        })),
      );
    }
    return row.id;
  }

  async enroll(
    tenant: TenantFixture,
    studentId: string,
    classId: string,
    opts: { from: string; to?: string; feeOverrideCents?: number } = { from: '2026-01-01' },
  ): Promise<void> {
    await this.db.insert(schema.enrollments).values({
      tenantId: tenant.id,
      studentId,
      classId,
      fromMonth: opts.from,
      toMonth: opts.to ?? null,
      feeOverrideCents: opts.feeOverrideCents ?? null,
      reason: opts.feeOverrideCents === undefined ? null : 'Sibling discount',
    });
  }

  async setTenantStatus(tenant: TenantFixture, status: TenantStatus): Promise<void> {
    await this.db.update(schema.tenants).set({ status }).where(eq(schema.tenants.id, tenant.id));
  }

  async setUserStatus(user: UserFixture, status: 'active' | 'disabled'): Promise<void> {
    await this.db
      .update(schema.tenantUsers)
      .set({ status })
      .where(eq(schema.tenantUsers.id, user.id));
  }

  sessionsOf(user: UserFixture) {
    return this.db
      .select()
      .from(schema.sessions)
      .where(eq(schema.sessions.userId, user.id))
      .orderBy(schema.sessions.createdAt);
  }

  devicesOf(user: UserFixture) {
    return this.db.select().from(schema.devices).where(eq(schema.devices.userId, user.id));
  }

  audits(tenant: TenantFixture, action?: string) {
    return this.db
      .select()
      .from(schema.auditLogs)
      .where(
        and(
          eq(schema.auditLogs.tenantId, tenant.id),
          action ? eq(schema.auditLogs.action, action) : sql`true`,
        ),
      )
      .orderBy(schema.auditLogs.createdAt, schema.auditLogs.id);
  }
}

/** Parsed `Set-Cookie` lines of a response, by cookie name. */
export function setCookies(res: request.Response): Map<string, string> {
  const raw = res.headers['set-cookie'] as unknown;
  const lines = Array.isArray(raw) ? (raw as string[]) : typeof raw === 'string' ? [raw] : [];
  const map = new Map<string, string>();
  for (const line of lines) map.set(line.slice(0, line.indexOf('=')), line);
  return map;
}

/** The value of a cookie in a `Set-Cookie` line. */
export function cookieValue(line: string | undefined): string {
  if (!line) throw new Error('cookie not set');
  return line.slice(line.indexOf('=') + 1, line.indexOf(';'));
}

export interface Client {
  get(path: string, cookie?: string): request.Test;
  post(path: string, body?: object, cookie?: string): request.Test;
}

/** A random documentation-range client IP, so tests don't share the per-IP login budget. */
const randomIp = () => `198.18.${randomBytes(1)[0] ?? 0}.${randomBytes(1)[0] ?? 0}`;

/**
 * Requests to one tenant host, as the web app's server would send them (no Origin), from a
 * random client IP (forwarded by the trusted loopback peer). `.set('X-Forwarded-For', …)`
 * afterwards pins the IP.
 */
export function client(t: DbTestApp, host: string): Client {
  return {
    get: (path, cookie) => {
      const req = request(t.server).get(path).set('Host', host).set('X-Forwarded-For', randomIp());
      return cookie ? req.set('Cookie', cookie) : req;
    },
    post: (path, body = {}, cookie) => {
      const req = request(t.server)
        .post(path)
        .set('Host', host)
        .set('X-Forwarded-For', randomIp())
        .set('Content-Type', 'application/json');
      return (cookie ? req.set('Cookie', cookie) : req).send(JSON.stringify(body));
    },
  };
}
