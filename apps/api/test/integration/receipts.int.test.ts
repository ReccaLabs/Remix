import { and, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { schema, withTenant, type Db } from '@remix/db';
import { receiptSchema, signedUrlSchema, type StaffRole } from '@remix/types/api';
import { MockStorageProvider } from '../../src/integrations/storage/storage.mock';
import { STORAGE_PROVIDER } from '../../src/integrations/storage/storage.provider';
import { ReceiptJobRunner } from '../../src/modules/fees/receipt-jobs';
import { expectProblem } from '../fixtures/problem';
import {
  createDbTestApp,
  Factory,
  ownerDb,
  type DbTestApp,
  type TenantFixture,
  type UserFixture,
} from './support/db-app';
import { appDb, feesOf, lines } from './support/fees';
import { api, signInStaff, signInStudent, staffByRole, type Api } from './support/people';

describe('FEE-09 receipt data, worker and signed downloads against Postgres', () => {
  let t: DbTestApp;
  let db: Db;
  let f: Factory;
  let tenant: TenantFixture;
  let other: TenantFixture;
  let staff: Record<StaffRole, { user: UserFixture; api: Api }>;
  let student: UserFixture;
  let otherStudent: UserFixture;
  let receiptId: string;
  let otherReceiptId: string;
  let paymentId: string;
  let storage: MockStorageProvider;
  const pdf = (id = receiptId) => `/api/v1/receipts/${id}/pdf`;
  const data = (id = receiptId) => `/api/v1/admin/receipts/${id}`;
  async function paid(tn: TenantFixture) {
    const student = await f.student(tn);
    const klass = await f.klass(tn, { name: 'Sample Physics', feeCents: 250000 });
    await f.enroll(tn, student.id, klass, { from: '2026-10-01' });
    await feesOf(t).generateInvoices(tn.id, '2026-10');
    const line = (await lines(db, tn.id)).find((l) => l.student_id === student.id)!;
    const recorded = await feesOf(t).recordPayment(tn.id, {
      method: 'cash',
      amountCents: 250000,
      cashReceivedCents: 300000,
      lines: [line.id],
      idempotencyKey: `test-${student.id}`,
      receivedBy: null,
    });
    return { student, recorded };
  }
  beforeAll(async () => {
    t = await createDbTestApp();
    db = ownerDb();
    f = new Factory(db);
    tenant = await f.tenant();
    other = await f.tenant();
    staff = await staffByRole(t, f, tenant);
    const mine = await paid(tenant);
    const theirs = await paid(other);
    student = mine.student;
    otherStudent = theirs.student;
    receiptId = mine.recorded.receiptId!;
    paymentId = mine.recorded.payment.id;
    otherReceiptId = theirs.recorded.receiptId!;
    storage = t.app.get(STORAGE_PROVIDER);
    await staff.owner.api.patch('/api/v1/admin/settings/fees', {
      receipt: { address: 'Sample Road', phone: '0111234567', footer: 'Thank you' },
    });
  });
  afterAll(async () => {
    await t.close();
    await db.$client.end();
  });
  it('returns the contract receipt header, payment lines and cash/change to the cashier', async () => {
    const res = await staff.cashier.api.get(data());
    expect(res.status).toBe(200);
    expect(receiptSchema.strict().parse(res.body)).toMatchObject({
      amountCents: 250000,
      cashReceivedCents: 300000,
      changeCents: 50000,
      institute: { address: 'Sample Road', phone: '0111234567', footer: 'Thank you' },
      lines: [{ className: 'Sample Physics', amountCents: 250000 }],
    });
    expect(res.headers['cache-control']).toBe('no-store');
  });
  it('queues only committed payments; denies signing while pending; renders once across concurrent retries', async () => {
    const jobs = t.jobs.of('receipts');
    expect(jobs.some((j) => j.payload.paymentId === paymentId)).toBe(true);
    expect(jobs.find((j) => j.payload.paymentId === paymentId)?.jobId).toBe(
      encodeURIComponent(`receipt:${tenant.id}:${paymentId}`),
    );
    const before = storage.callsTo('createDownloadUrl').length;
    expectProblem(await staff.cashier.api.get(pdf()), 409, 'CONFLICT');
    expect(storage.callsTo('createDownloadUrl')).toHaveLength(before);
    const runner = t.app.get(ReceiptJobRunner);
    const payload = { tenantId: tenant.id, paymentId, receiptId };
    await Promise.all([runner.run(payload), runner.run(payload)]);
    await runner.run(payload);
    const [row] = await withTenant(db, tenant.id, (tx) =>
      tx.select().from(schema.receipts).where(eq(schema.receipts.id, receiptId)),
    );
    expect(row?.pdfKey).toBe(`${tenant.id}/receipts/2026/10/${receiptId}.pdf`);
    expect(storage.objects.size).toBe(1);
    expect(storage.callsTo('putObject')).toHaveLength(1);
    expect(storage.contents.get(row!.pdfKey!)?.body.subarray(0, 8).toString()).toBe('%PDF-1.4');
  });
  it('recovers from a failed write without pdf_key, then retries the same key', async () => {
    const extra = await paid(tenant);
    const runner = t.app.get(ReceiptJobRunner);
    storage.failNext(new Error('Test storage unavailable'));
    await expect(
      runner.run({
        tenantId: tenant.id,
        paymentId: extra.recorded.payment.id,
        receiptId: extra.recorded.receiptId!,
      }),
    ).rejects.toThrow();
    const rows = () =>
      withTenant(db, tenant.id, (tx) =>
        tx.select().from(schema.receipts).where(eq(schema.receipts.id, extra.recorded.receiptId!)),
      );
    expect((await rows())[0]?.pdfKey).toBeNull();
    await runner.run({
      tenantId: tenant.id,
      paymentId: extra.recorded.payment.id,
      receiptId: extra.recorded.receiptId!,
    });
    expect((await rows())[0]?.pdfKey).toBe(
      `${tenant.id}/receipts/2026/10/${extra.recorded.receiptId}.pdf`,
    );
  });
  it('only fees.read staff or the receipt’s own student receive a <=10 minute URL', async () => {
    for (const role of ['owner', 'admin', 'cashier'] as const) {
      const before = Date.now();
      const res = await staff[role].api.get(pdf());
      expect(res.status).toBe(200);
      const signed = signedUrlSchema.strict().parse(res.body);
      expect(new Date(signed.expiresAt).getTime() - before).toBeLessThanOrEqual(601000);
      expect(res.headers['cache-control']).toBe('no-store');
    }
    const own = api(t, tenant.host, await signInStudent(t, tenant, student));
    expect((await own.get(pdf())).status).toBe(200);
    const another = api(t, tenant.host, await signInStudent(t, tenant, await f.student(tenant)));
    const calls = storage.callsTo('createDownloadUrl').length;
    expectProblem(await another.get(pdf()), 404, 'NOT_FOUND');
    for (const role of ['teacher', 'gatekeeper'] as const) {
      expectProblem(await staff[role].api.get(pdf()), 403, 'FORBIDDEN');
      expectProblem(await staff[role].api.get(data()), 403, 'FORBIDDEN');
    }
    expectProblem(await api(t, tenant.host).get(pdf()), 401, 'UNAUTHENTICATED');
    expect(storage.callsTo('createDownloadUrl')).toHaveLength(calls);
    expectProblem(await own.get(data()), 403, 'FORBIDDEN');
  });
  it('refuses foreign receipt ids and host-swapped cookies before storage; the job cannot cross tenants', async () => {
    const calls = storage.callsTo('createDownloadUrl').length;
    expectProblem(await staff.cashier.api.get(pdf(otherReceiptId)), 404, 'NOT_FOUND');
    expectProblem(await staff.cashier.api.get(data(otherReceiptId)), 404, 'NOT_FOUND');
    const otherOwner = await f.staff(other, ['owner']);
    const cookie = await signInStaff(t, other, otherOwner);
    expectProblem(await api(t, tenant.host, cookie).get(pdf()), 401, 'UNAUTHENTICATED');
    const otherPortal = api(t, other.host, await signInStudent(t, other, otherStudent));
    expectProblem(await otherPortal.get(pdf()), 404, 'NOT_FOUND');
    expect(storage.callsTo('createDownloadUrl')).toHaveLength(calls);
    await expect(
      t.app.get(ReceiptJobRunner).run({ tenantId: other.id, paymentId, receiptId }),
    ).rejects.toThrow();
  });
  it('does not enqueue or store for a rolled-back payment', async () => {
    const before = t.jobs.of('receipts').length;
    await expect(
      feesOf(t).recordPayment(tenant.id, {
        method: 'cash',
        amountCents: 1,
        lines: [],
        idempotencyKey: 'bad-payment-test',
        receivedBy: null,
      }),
    ).rejects.toThrow();
    expect(t.jobs.of('receipts')).toHaveLength(before);
  });
  it('rejects a stored key for another tenant before invoking the signer', async () => {
    // DB CHECK is also pinned by the isolation suite: even a permitted pdf_key update cannot cross.
    await expect(
      withTenant(appDb(t), tenant.id, (tx) =>
        tx
          .update(schema.receipts)
          .set({ pdfKey: `${other.id}/receipts/test.pdf` })
          .where(and(eq(schema.receipts.id, receiptId), sql`true`)),
      ),
    ).rejects.toThrow();
    const signed = (await staff.cashier.api.get(pdf())).body.url as string;
    expect(t.logs.text).not.toContain(signed);
  });
});
