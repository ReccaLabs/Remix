import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Db } from '@remix/db';
import { paymentSchema, type StaffRole } from '@remix/types/api';
import { expectProblem } from '../fixtures/problem';
import { createDbTestApp, Factory, ownerDb, type DbTestApp, type TenantFixture, type UserFixture } from './support/db-app';
import { feesOf, lines, scalar } from './support/fees';
import { api, signInStudent, staffByRole, type Api } from './support/people';

const URL = '/api/v1/admin/payments/manual';
describe('manual collection (FEE-08), real Postgres RLS', () => {
  let t: DbTestApp;
  let db: Db;
  let f: Factory;
  let tenant: TenantFixture;
  let other: TenantFixture;
  let staff: Record<StaffRole, { user: UserFixture; api: Api }>;
  async function selection(tn = tenant) {
    const student = await f.student(tn);
    const klass = await f.klass(tn, { name: 'Manual class', feeCents: 250_000 });
    await f.enroll(tn, student.id, klass, { from: '2026-09-01' });
    await feesOf(t).generateInvoices(tn.id, '2026-09');
    await feesOf(t).generateInvoices(tn.id, '2026-10');
    const selected = (await lines(db, tn.id)).filter(l => l.student_id === student.id);
    return { student, body: { studentId: student.id, lineIds: selected.map(l => l.id),
      kind: 'bank_transfer' as const, reference: 'BANK-123', receivedOn: '2026-10-14', note: 'Statement checked', idempotencyKey: randomUUID() } };
  }
  beforeAll(async () => {
    t = await createDbTestApp(); db = ownerDb(); f = new Factory(db);
    tenant = await f.tenant(); other = await f.tenant(); staff = await staffByRole(t, f, tenant);
  });
  afterAll(async () => { await t.close(); await db.$client.end(); });
  for (const role of ['owner', 'admin', 'cashier', 'teacher', 'gatekeeper'] as const) {
    it(`${role} collection permission`, async () => {
      const { body } = await selection();
      const res = await staff[role].api.post(URL, body);
      if (['owner', 'admin', 'cashier'].includes(role)) {
        expect(res.status).toBe(200); paymentSchema.strict().parse(res.body);
      } else expectProblem(res, 403, 'FORBIDDEN');
    });
  }
  it('refuses students and anonymous callers', async () => {
    const { student, body } = await selection();
    const cookie = await signInStudent(t, tenant, student);
    expectProblem(await api(t, tenant.host, cookie).post(URL, body), 403, 'FORBIDDEN');
    expectProblem(await api(t, tenant.host).post(URL, body), 401, 'UNAUTHENTICATED');
  });
  for (const kind of ['bank_transfer', 'cheque', 'other'] as const) {
    it(`records ${kind}, exact balances, reference, date and audited actor/kind`, async () => {
      const { body } = await selection();
      const res = await staff.cashier.api.post(URL, { ...body, kind });
      expect(res.status).toBe(200);
      const p = paymentSchema.strict().parse(res.body);
      expect(p).toMatchObject({ method: 'manual', amountCents: 500_000, reference: body.reference, note: body.note });
      expect(p.receivedAt.slice(0, 10)).toBe(body.receivedOn);
      expect(p.lines).toHaveLength(2);
      expect(await scalar(db, tenant.id, sql`select actor_id as v from audit_logs where entity_id = ${p.id}::uuid and action = 'payment.record'`)).toBe(staff.cashier.user.id);
      expect(await scalar(db, tenant.id, sql`select after->>'manualKind' as v from audit_logs where entity_id = ${p.id}::uuid and action = 'payment.record'`)).toBe(kind);
      expect(t.jobs.of('receipts').filter(j => j.payload.paymentId === p.id)).toHaveLength(1);
    });
  }
  it('identical concurrent submissions/retries create one payment/receipt; every changed field conflicts', async () => {
    const { body } = await selection();
    const [a, b] = await Promise.all([staff.cashier.api.post(URL, body), staff.cashier.api.post(URL, body)]);
    expect(a.status).toBe(200); expect(a.body).toEqual(b.body);
    expect((await staff.cashier.api.post(URL, body)).body.id).toBe(a.body.id);
    for (const changed of [{ kind: 'cheque' }, { reference: 'other' }, { receivedOn: '2026-10-13' }, { note: 'changed' }, { studentId: randomUUID() }, { lineIds: [randomUUID()] }]) {
      expectProblem(await staff.cashier.api.post(URL, { ...body, ...changed }), 409, 'CONFLICT');
    }
    expect(await scalar(db, tenant.id, sql`select count(*)::int as v from payments where idempotency_key = ${body.idempotencyKey}`)).toBe(1);
    expect(await scalar(db, tenant.id, sql`select count(*)::int as v from receipts where payment_id = ${a.body.id}::uuid`)).toBe(1);
    expectProblem(await staff.cashier.api.post(URL, { ...body, idempotencyKey: randomUUID() }), 409, 'ALREADY_PAID');
  });
  it('rejects future/too old/invalid dates and accepts the earliest boundary', async () => {
    const { body } = await selection();
    for (const receivedOn of ['2026-10-16', '2025-08-31', '2026-02-30']) {
      expectProblem(await staff.cashier.api.post(URL, { ...body, receivedOn }), 400, 'VALIDATION_FAILED');
    }
    expect((await staff.cashier.api.post(URL, { ...body, receivedOn: '2025-09-01' })).status).toBe(200);
  });
  it('foreign tenant ids and another local student are rejected without leaks', async () => {
    const a = await selection(); const b = await selection(); const foreign = await selection(other);
    expectProblem(await staff.cashier.api.post(URL, foreign.body), 404, 'NOT_FOUND');
    expectProblem(await staff.cashier.api.post(URL, { ...a.body, studentId: foreign.student.id }), 404, 'NOT_FOUND');
    expectProblem(await staff.cashier.api.post(URL, { ...a.body, studentId: b.student.id }), 404, 'NOT_FOUND');
  });
});
