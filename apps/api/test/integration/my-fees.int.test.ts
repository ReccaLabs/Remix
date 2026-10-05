import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Db } from '@remix/db';
import { myFeesResponseSchema, type StaffRole } from '@remix/types/api';
import { expectProblem } from '../fixtures/problem';
import { createDbTestApp, Factory, ownerDb, type DbTestApp, type TenantFixture, type UserFixture } from './support/db-app';
import { feesOf, lines } from './support/fees';
import { api, signInStudent, staffByRole, type Api } from './support/people';

describe('student-only myFees (FEE-10), real Postgres RLS', () => {
  let t: DbTestApp; let db: Db; let f: Factory;
  let tenant: TenantFixture; let other: TenantFixture;
  let staff: Record<StaffRole, { user: UserFixture; api: Api }>;
  let mine: { student: UserFixture; api: Api; lineIds: string[]; paymentId: string };
  let theirs: typeof mine;
  let foreign: typeof mine;
  async function seed(tn: TenantFixture) {
    const student = await f.student(tn);
    const k = await f.klass(tn, { name: 'Student-only class', feeCents: 250_000 });
    await f.enroll(tn, student.id, k, { from: '2026-09-01' });
    await feesOf(t).generateInvoices(tn.id, '2026-09');
    await feesOf(t).generateInvoices(tn.id, '2026-10');
    const lineIds = (await lines(db, tn.id)).filter(l => l.student_id === student.id).map(l => l.id);
    const paid = await feesOf(t).recordPayment(tn.id, { method: 'cash', lines: lineIds.slice(0, 1), amountCents: 250_000,
      receivedBy: null, idempotencyKey: randomUUID() });
    const cookie = await signInStudent(t, tn, student);
    return { student, api: api(t, tn.host, cookie), lineIds, paymentId: paid.payment.id };
  }
  beforeAll(async () => {
    t = await createDbTestApp({ INTEGRATIONS_KEY: Buffer.alloc(32, 9).toString('base64') });
    db = ownerDb(); f = new Factory(db); tenant = await f.tenant(); other = await f.tenant();
    staff = await staffByRole(t, f, tenant);
    mine = await seed(tenant); theirs = await seed(tenant); foreign = await seed(other);
  });
  afterAll(async () => { await t.close(); await db.$client.end(); });
  for (const role of ['owner', 'admin', 'cashier', 'teacher', 'gatekeeper'] as const) {
    it(`refuses ${role} on the student endpoint`, async () => {
      expectProblem(await staff[role].api.get('/api/v1/me/fees'), 403, 'FORBIDDEN');
    });
  }
  it('returns only own open enrolment lines and own payments; strips staff surplus fields, disables caching', async () => {
    for (const own of [mine, theirs, foreign]) {
      const res = await own.api.get('/api/v1/me/fees');
      expect(res.status).toBe(200); expect(res.headers['cache-control']).toBe('no-store');
      const parsed = myFeesResponseSchema.strict().parse(res.body);
      expect(parsed.openLines.map(l => l.id)).toEqual(own.lineIds.slice(1));
      expect(parsed.payments.map(p => p.id)).toEqual([own.paymentId]);
      expect(parsed.payments.every(p => p.studentId === own.student.id)).toBe(true);
      expect(res.body.payments[0]).not.toHaveProperty('needsRefund');
      expect(res.body.payments[0]).not.toHaveProperty('unallocatedCents');
      expect(parsed).toMatchObject({ slips: [], cardEnabled: false, bankDetails: null });
    }
    expectProblem(await api(t, tenant.host).get('/api/v1/me/fees'), 401, 'UNAUTHENTICATED');
    const attempted = await mine.api.get(`/api/v1/me/fees?studentId=${theirs.student.id}`);
    expect(attempted.body.payments.map((p: { id: string }) => p.id)).toEqual([mine.paymentId]);
  });
  it('returns configured bank/card flags without secrets, isolated to the institute', async () => {
    const bankDetails = { bankName: 'Sample Bank', branch: 'Colombo', accountNumber: '123456789', accountName: 'Sample Institute' };
    expect((await staff.owner.api.patch('/api/v1/admin/settings/fees', { bankDetails })).status).toBe(200);
    expect((await staff.owner.api.patch('/api/v1/admin/settings/payhere', { enabled: true, merchantId: '123456', merchantSecret: 'sample-test-secret' })).status).toBe(200);
    const res = await mine.api.get('/api/v1/me/fees');
    expect(res.body).toMatchObject({ bankDetails, cardEnabled: true });
    expect(JSON.stringify(res.body)).not.toContain('sample-test-secret');
    expect((await foreign.api.get('/api/v1/me/fees')).body).toMatchObject({ bankDetails: null, cardEnabled: false });
  });
  it('includes original/reversal state newest first and reopens the month', async () => {
    const reversed = await staff.owner.api.post(`/api/v1/admin/payments/${mine.paymentId}/reverse`, { reason: 'Incorrect cash entry' });
    expect(reversed.status).toBe(200);
    const parsed = myFeesResponseSchema.parse((await mine.api.get('/api/v1/me/fees')).body);
    expect(parsed.openLines).toHaveLength(2);
    expect(parsed.payments.map(p => p.id)).toEqual([reversed.body.id, mine.paymentId]);
    expect(parsed.payments[0]?.reversesPaymentId).toBe(mine.paymentId);
    expect(parsed.payments[1]?.reversedByPaymentId).toBe(reversed.body.id);
    expect((await theirs.api.get('/api/v1/me/fees')).body.payments).toHaveLength(1);
  });
});
