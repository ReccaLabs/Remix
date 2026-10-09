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
import { MockSmsProvider } from '../../../src/integrations/sms/sms.mock';
import { JOB_PRODUCER } from '../../../src/jobs/job-producer';
import { createSmsProcessor, SMS_BILLING } from '../../../src/jobs/sms/sms.processor';
import { InlineJobProducer } from '../../../src/jobs/testing/inline-jobs';
import { ImportRunner } from '../../../src/modules/imports/import-runner';
import { ReceiptJobRunner } from '../../../src/modules/fees/receipt-jobs';
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
  /** The `sms` queue, run inline by the real processor into {@link sms}. */
  jobs: InlineJobProducer;
  /** Messages the SMS worker would have sent (filled by `jobs.drain()`). */
  sms: MockSmsProvider;
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
  const sms = new MockSmsProvider();
  // The `imports` processor needs the app (DB, hooks): it is bound once the app exists.
  const processors: ConstructorParameters<typeof InlineJobProducer>[0] = {
    sms: createSmsProcessor(sms),
  };
  const jobs = new InlineJobProducer(processors);
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule.forRoot({ config, logDestination: logs })],
  })
    .overrideProvider(CLOCK)
    .useValue(clock)
    .overrideProvider(RATE_LIMITER)
    .useValue(limiter)
    .overrideProvider(JOB_PRODUCER)
    .useValue(jobs)
    .compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>({
    bodyParser: false,
    bufferLogs: true,
  });
  configureApp(app, config);
  await app.init();
  const importRunner = app.get(ImportRunner);
  // Wallet-billed SMS report back to the wallet exactly like the worker process does.
  processors.sms = createSmsProcessor(sms, app.get(SMS_BILLING));
  processors.receipts = (payload) => app.get(ReceiptJobRunner).run(payload);
  processors.imports = async (payload, ctx) => {
    await importRunner.run(payload, ctx);
  };
  return {
    app,
    server: app.getHttpServer(),
    clock,
    limiter,
    tenantCache: app.get<InMemoryTenantCache>(TENANT_CACHE),
    logs,
    jobs,
    sms,
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
  prefix: string;
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
    for (;;) {
      const prefix = [...randomBytes(4)].map((n) => String.fromCharCode(65 + (n % 26))).join('');
      const [row] = await this.db
        .insert(schema.tenants)
        .values({ slug, name: `Test ${slug}`, plan: 'institute', status, studentNoPrefix: prefix })
        .onConflictDoNothing({ target: schema.tenants.studentNoPrefix })
        .returning({ id: schema.tenants.id });
      if (row) return { id: row.id, slug, host: `${slug}.${BASE_DOMAIN}`, prefix };
    }
  }

  async student(
    tenant: TenantFixture,
    opts: {
      phone?: string;
      status?: 'active' | 'disabled' | 'invited';
      archived?: boolean;
      name?: string;
      passwordHash?: string | null;
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
        passwordHash:
          opts.passwordHash === null
            ? null
            : (opts.passwordHash ?? (opts.status === 'invited' ? null : await this.hash())),
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
    opts: {
      email?: string;
      status?: 'active' | 'disabled';
      name?: string;
      phone?: string | null;
    } = {},
  ): Promise<UserFixture> {
    const phone = opts.phone === undefined ? uniquePhone() : opts.phone;
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
    return { id: user.id, phone: phone ?? '', email };
  }

  async klass(
    tenant: TenantFixture,
    opts: {
      name: string;
      feeCents: number;
      teacherId?: string | null;
      archived?: boolean;
      schedules?: Array<[number, string, number]>;
      hallId?: string | null;
      place?: 'hall' | 'online' | 'hybrid';
      startsOn?: string | null;
      grade?: string;
    },
  ): Promise<string> {
    const [row] = await this.db
      .insert(schema.classes)
      .values({
        tenantId: tenant.id,
        name: opts.name,
        grade: opts.grade ?? '2027 A/L',
        medium: 'sinhala',
        teacherId: opts.teacherId ?? null,
        hallId: opts.hallId ?? null,
        feeCents: opts.feeCents,
        place: opts.place ?? 'hall',
        startsOn: opts.startsOn ?? null,
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

  async hall(tenant: TenantFixture, name: string, capacity: number | null = null): Promise<string> {
    const [row] = await this.db
      .insert(schema.halls)
      .values({ tenantId: tenant.id, name, capacity })
      .returning({ id: schema.halls.id });
    if (!row) throw new Error('hall not created');
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
  patch(path: string, body?: object, cookie?: string): request.Test;
  del(path: string, cookie?: string): request.Test;
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
    patch: (path, body = {}, cookie) => {
      const req = request(t.server)
        .patch(path)
        .set('Host', host)
        .set('X-Forwarded-For', randomIp())
        .set('Content-Type', 'application/json');
      return (cookie ? req.set('Cookie', cookie) : req).send(JSON.stringify(body));
    },
    del: (path, cookie) => {
      const req = request(t.server)
        .delete(path)
        .set('Host', host)
        .set('X-Forwarded-For', randomIp())
        .set('Content-Type', 'application/json');
      return (cookie ? req.set('Cookie', cookie) : req).send('{}');
    },
  };
}
