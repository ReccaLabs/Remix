import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withTenant, type Db } from '@remix/db';
import { paymentSchema, receiptSchema, type StaffRole } from '@remix/types/api';
import { expectProblem } from '../fixtures/problem';
import { createDbTestApp, Factory, ownerDb, type DbTestApp, type TenantFixture, type UserFixture } from './support/db-app';
import { feesOf, lines, scalar } from './support/fees';
import { api, signInStudent, staffByRole, type Api } from './support/people';

const URL = '/api/v1/admin/payments/cash';
const FEE = 250_000;
describe('cash collection (FEE-07), real Postgres RLS', () => {
  let t: DbTestApp;
  let db: Db;
  let f: Factory;
  let tenant: TenantFixture;
  let other: TenantFixture;
  let staff: Record<StaffRole, { user: UserFixture; api: Api }>;
  async function selection(tn = tenant) {
    const student = await f.student(tn);
    const klass = await f.klass(tn, { name: 'Collection class', feeCents: FEE });
    await f.enroll(tn, student.id, klass, { from: '2026-09-01' });
    await feesOf(t).generateInvoices(tn.id, '2026-09');
    await feesOf(t).generateInvoices(tn.id, '2026-10');
    const selected = (await lines(db, tn.id)).filter(l => l.student_id === student.id);
    return { student, body: { studentId: student.id, lineIds: selected.map(l => l.id),
      cashReceivedCents: 600_000, idempotencyKey: randomUUID() } };
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
  it('collects two months, prints change, audits actor and enqueues one receipt after commit', async () => {
    const { body } = await selection();
    const res = await staff.cashier.api.post(URL, body);
    expect(res.status).toBe(200);
    const p = paymentSchema.strict().parse(res.body);
    expect(p.amountCents).toBe(500_000); expect(p.lines).toHaveLength(2);
    const receipt = receiptSchema.strict().parse((await staff.cashier.api.get(`/api/v1/admin/receipts/${p.receiptId}`)).body);
    expect(receipt).toMatchObject({ cashReceivedCents: 600_000, changeCents: 100_000 });
    expect(await scalar(db, tenant.id, sql`select actor_id as v from audit_logs where entity_id = ${p.id}::uuid and action = 'payment.record'`)).toBe(staff.cashier.user.id);
    expect((await staff.cashier.api.get(`/api/v1/admin/students/${body.studentId}/fees`)).body.openLines).toEqual([]);
    expect(t.jobs.of('receipts').filter(j => j.payload.paymentId === p.id)).toHaveLength(1);
  });
  it('replays and concurrent identical submits create one payment and receipt, changed body conflicts', async () => {
    const { body } = await selection();
    const [a, b] = await Promise.all([staff.cashier.api.post(URL, body), staff.cashier.api.post(URL, body)]);
    expect(a.status).toBe(200); expect(b.status).toBe(200); expect(a.body).toEqual(b.body);
    expect((await staff.cashier.api.post(URL, body)).body.id).toBe(a.body.id);
    expectProblem(await staff.cashier.api.post(URL, { ...body, cashReceivedCents: 700_000 }), 409, 'CONFLICT');
    expectProblem(await staff.cashier.api.post(URL, { ...body, lineIds: [body.lineIds[0]] }), 409, 'CONFLICT');
    expect(await scalar(db, tenant.id, sql`select count(*)::int as v from payments where idempotency_key = ${body.idempotencyKey}`)).toBe(1);
    expect(await scalar(db, tenant.id, sql`select count(*)::int as v from receipts where payment_id = ${a.body.id}::uuid`)).toBe(1);
  });
  it('distinct concurrent attempts conflict, paid lines never create zero receipts', async () => {
    const { body } = await selection();
    const responses = await Promise.all([staff.cashier.api.post(URL, body), staff.cashier.api.post(URL, { ...body, idempotencyKey: randomUUID() })]);
    expect(responses.map(r => r.status).sort()).toEqual([200, 409]);
    expectProblem(responses.find(r => r.status === 409)!, 409, 'ALREADY_PAID');
    expectProblem(await staff.cashier.api.post(URL, { ...body, idempotencyKey: randomUUID() }), 409, 'ALREADY_PAID');
  });
  it('insufficient cash, duplicate or voided lines fail without writing', async () => {
    const { body } = await selection();
    expectProblem(await staff.cashier.api.post(URL, { ...body, cashReceivedCents: 499_999 }), 400, 'VALIDATION_FAILED');
    expectProblem(await staff.cashier.api.post(URL, { ...body, lineIds: [body.lineIds[0], body.lineIds[0]] }), 400, 'VALIDATION_FAILED');
    await withTenant(db, tenant.id, tx => tx.execute(sql`update invoice_lines set voided_at = now(), void_reason = 'Ended' where id = ${body.lineIds[0]}::uuid`));
    expectProblem(await staff.cashier.api.post(URL, body), 400, 'VALIDATION_FAILED');
    expect(await scalar(db, tenant.id, sql`select count(*)::int as v from payments where idempotency_key = ${body.idempotencyKey}`)).toBe(0);
  });
  it('foreign tenant lines/student return 404 and another local student is rejected', async () => {
    const a = await selection(); const b = await selection(); const foreign = await selection(other);
    expectProblem(await staff.cashier.api.post(URL, foreign.body), 404, 'NOT_FOUND');
    expectProblem(await staff.cashier.api.post(URL, { ...a.body, studentId: foreign.student.id }), 404, 'NOT_FOUND');
    expectProblem(await staff.cashier.api.post(URL, { ...a.body, studentId: b.student.id }), 404, 'NOT_FOUND');
  });
});


