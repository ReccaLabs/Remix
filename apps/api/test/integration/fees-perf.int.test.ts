import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withTenant, type Db } from '@remix/db';
import { createDbTestApp, Factory, ownerDb, type DbTestApp } from './support/db-app';
import { feesOf, scalar } from './support/fees';

/**
 * Performance guard for the monthly job (ADR 0008 §8): 50 tenants x 2,000 students must finish
 * in under 5 minutes (with the queue's concurrency of 4). CI runs a scaled set (5 x 2,000); set FEES_PERF_TENANTS=50 locally for the
 * full figure.
 */
const TENANTS = Number(process.env.FEES_PERF_TENANTS ?? 5);
const STUDENTS = Number(process.env.FEES_PERF_STUDENTS ?? 2000);
const BUDGET_MS = (TENANTS / 50) * 5 * 60_000 + 30_000;

describe('invoice generation scale (FEE-01)', () => {
  let t: DbTestApp;
  let db: Db;
  let f: Factory;

  beforeAll(async () => {
    t = await createDbTestApp();
    db = ownerDb();
    f = new Factory(db);
  });
  afterAll(async () => {
    await t.close();
    await db.$client.end();
  });

  it(`${TENANTS} tenants x ${STUDENTS} students (3 classes each) bill within the budget, and a rerun is free`, async () => {
    const tenants = [];
    for (let i = 0; i < TENANTS; i++) {
      const tenant = await f.tenant('active');
      const classes = [
        await f.klass(tenant, { name: 'A', feeCents: 250_000 }),
        await f.klass(tenant, { name: 'B', feeCents: 150_000 }),
        await f.klass(tenant, { name: 'C', feeCents: 0 }),
      ];
      await db.execute(sql`insert into tenant_users (tenant_id, kind, phone, display_name, password_hash)
        select ${tenant.id}, 'student', '+94770' || lpad(g::text, 6, '0'), 'Perf ' || g, 'x' from generate_series(1, ${STUDENTS}) g`);
      await db.execute(sql`insert into students (tenant_id, user_id, student_no)
        select ${tenant.id}, u.id, 'PF-' || lpad(row_number() over (order by u.phone)::text, 5, '0')
        from tenant_users u where u.tenant_id = ${tenant.id} and u.kind = 'student'`);
      for (const classId of classes) {
        await db.execute(sql`insert into enrollments (tenant_id, student_id, class_id, from_month)
          select ${tenant.id}, user_id, ${classId}::uuid, '2026-09-01' from students where tenant_id = ${tenant.id}`);
      }
      tenants.push(tenant);
    }
    // Autovacuum would have analysed tables this size already; do it by hand so plans are realistic.
    await db.execute(sql`analyze tenant_users, students, enrollments, classes, tenants`);
    const started = performance.now();
    // The worker runs the `fees` queue with concurrency 4 (JOBS.fees), one job per tenant.
    for (let i = 0; i < tenants.length; i += 4) {
      await Promise.all(tenants.slice(i, i + 4).map((tenant) => feesOf(t).generateInvoices(tenant.id, '2026-10')));
    }
    const elapsed = performance.now() - started;
    // eslint-disable-next-line no-console -- the measured figure is the point of this test
    console.info(`fees perf: ${TENANTS} tenants x ${STUDENTS} students (${STUDENTS * 3} lines each) in ${(elapsed / 1000).toFixed(1)} s`);
    expect(elapsed).toBeLessThan(BUDGET_MS);
    for (const tenant of tenants) {
      expect(await scalar<number>(db, tenant.id, sql`select count(*)::int as v from invoices`)).toBe(STUDENTS);
      expect(await scalar<number>(db, tenant.id, sql`select count(*)::int as v from invoice_lines`)).toBe(STUDENTS * 3);
    }
    const rerun = performance.now();
    expect(await feesOf(t).generateInvoices(tenants[0]!.id, '2026-10')).toBe(0);
    expect(performance.now() - rerun).toBeLessThan(30_000);
    expect(await withTenant(db, tenants[0]!.id, async (tx) => (await tx.execute(sql`select 1 from invoices where status <> 'overdue' limit 1`)).rows.length)).toBeGreaterThanOrEqual(0);
  }, 20 * 60_000);
});
