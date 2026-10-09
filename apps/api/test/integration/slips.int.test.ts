import { readFileSync } from 'node:fs';
import { sql } from 'drizzle-orm';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withTenant, type Db } from '@remix/db';
import {
  listSlipsResponseSchema,
  myFeesResponseSchema,
  signedUrlSchema,
  slipSchema,
  slipUploadResponseSchema,
  type StaffRole,
} from '@remix/types/api';
import { MockStorageProvider } from '../../src/integrations/storage/storage.mock';
import { STORAGE_PROVIDER } from '../../src/integrations/storage/storage.provider';
import { MediaJobRunner } from '../../src/modules/slips/media-jobs';
import { expectProblem } from '../fixtures/problem';
import { createDbTestApp, Factory, ownerDb, type DbTestApp, type TenantFixture, type UserFixture } from './support/db-app';
import { assertLedgerInvariants, feesOf, lines, scalar } from './support/fees';
import { api, signInStudent, staffByRole, type Api } from './support/people';

const HEIC = readFileSync(new URL('../fixtures/media/slip-hevc.heic', import.meta.url));
const BANK = { bankName: 'Sample Bank', branch: 'Colombo', accountNumber: '123456789', accountName: 'Sample Institute' };
const ROLES = ['owner', 'admin', 'cashier', 'teacher', 'gatekeeper'] as const;
const READERS: readonly StaffRole[] = ['owner', 'admin', 'cashier'];

/** A small JPEG with GPS EXIF, like a phone photo of a slip. */
function photo(): Promise<Buffer> {
  return sharp({ create: { width: 60, height: 40, channels: 3, background: '#e0e0e0' } })
    .withExif({ IFD0: { Make: 'PhoneCam' }, IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '6/1 55/1 0/1' } })
    .jpeg()
    .toBuffer();
}

describe('bank slips FEE-05/06, real Postgres RLS', () => {
  let t: DbTestApp;
  let db: Db;
  let f: Factory;
  let storage: MockStorageProvider;
  let tenant: TenantFixture;
  let other: TenantFixture;
  let staff: Record<StaffRole, { user: UserFixture; api: Api }>;
  let otherOwner: Api;

  interface Learner {
    tenant: TenantFixture;
    student: UserFixture;
    api: Api;
    lineIds: string[];
  }

  async function learner(tn: TenantFixture, name = 'Slip class'): Promise<Learner> {
    const student = await f.student(tn);
    const k = await f.klass(tn, { name, feeCents: 250_000 });
    await f.enroll(tn, student.id, k, { from: '2026-09-01' });
    await feesOf(t).generateInvoices(tn.id, '2026-09');
    await feesOf(t).generateInvoices(tn.id, '2026-10');
    const lineIds = (await lines(db, tn.id)).filter((l) => l.student_id === student.id).map((l) => l.id);
    return { tenant: tn, student, api: api(t, tn.host, await signInStudent(t, tn, student)), lineIds };
  }

  /** Request a presigned PUT and "upload" the bytes to the mock storage, as the browser would. */
  async function upload(who: Learner, body: Buffer, contentType = 'image/jpeg'): Promise<string> {
    const res = await who.api.post('/api/v1/me/slips/upload', { contentType, sizeBytes: body.length });
    expect(res.status).toBe(200);
    const parsed = slipUploadResponseSchema.parse(res.body);
    expect(parsed.headers).toEqual({ 'content-type': contentType });
    const objectKey = new URL(parsed.url).pathname.slice(1);
    expect(objectKey.startsWith(`${who.tenant.id}/slips/2026/10/`)).toBe(true);
    storage.put(who.tenant.id, objectKey.slice(who.tenant.id.length + 1), body, contentType);
    return parsed.uploadId;
  }

  async function submit(who: Learner, opts: { lineIds?: string[]; amountCents?: number; reference?: string; body?: Buffer } = {}) {
    const uploadId = await upload(who, opts.body ?? (await photo()));
    return who.api.post('/api/v1/me/slips', {
      uploadId,
      lineIds: opts.lineIds ?? who.lineIds,
      amountCents: opts.amountCents ?? 500_000,
      reference: opts.reference ?? `TX ${Math.random().toString(36).slice(2, 8)}`,
      slipDate: '2026-10-14',
    });
  }

  /** Submit and run the media job: the slip is `submitted` and in the cashier's queue. */
  async function queued(who: Learner, opts: Parameters<typeof submit>[1] = {}): Promise<string> {
    const res = await submit(who, opts);
    expect(res.status).toBe(200);
    await t.jobs.drain();
    return slipSchema.parse(res.body).id;
  }

  const slipCount = (tenantId: string, where = sql`true`) =>
    scalar<number>(db, tenantId, sql`select count(*)::int as v from bank_slips where ${where}`);

  beforeAll(async () => {
    t = await createDbTestApp({ INTEGRATIONS_KEY: Buffer.alloc(32, 9).toString('base64') });
    db = ownerDb();
    f = new Factory(db);
    storage = t.app.get(STORAGE_PROVIDER);
    tenant = await f.tenant();
    other = await f.tenant();
    staff = await staffByRole(t, f, tenant);
    otherOwner = (await staffByRole(t, f, other, ['owner'])).owner.api;
    expect((await staff.owner.api.patch('/api/v1/admin/settings/fees', { bankDetails: BANK })).status).toBe(200);
    expect((await otherOwner.patch('/api/v1/admin/settings/fees', { bankDetails: BANK })).status).toBe(200);
  });
  afterAll(async () => {
    await t.close();
    await db.$client.end();
  });

  describe('student upload and submit (FEE-05)', () => {
    it('refuses uploads until the institute has bank details, and validates type and size', async () => {
      const noBank = await f.tenant();
      const who = await learner(noBank);
      expectProblem(await who.api.post('/api/v1/me/slips/upload', { contentType: 'image/jpeg', sizeBytes: 100 }), 409, 'CONFLICT');
      const me = await learner(tenant, 'Validation class');
      expectProblem(await me.api.post('/api/v1/me/slips/upload', { contentType: 'image/gif', sizeBytes: 100 }), 400, 'VALIDATION_FAILED');
      expectProblem(await me.api.post('/api/v1/me/slips/upload', { contentType: 'image/png', sizeBytes: 5 * 1024 * 1024 + 1 }), 400, 'VALIDATION_FAILED');
      expectProblem(await me.api.post('/api/v1/me/slips/upload', { contentType: 'image/png', sizeBytes: 10, key: 'x' }), 400, 'VALIDATION_FAILED');
      await upload(me, await photo());
      const signed = storage.callsTo<{ expiresInSec: number; sizeBytes: number }>('createUploadUrl').at(-1);
      expect(signed?.expiresInSec).toBeLessThanOrEqual(600);
      expect(signed?.sizeBytes).toBe((await photo()).length);
    });

    it('refuses staff on the student endpoints and students on the cashier endpoints', async () => {
      const me = await learner(tenant, 'Kinds class');
      for (const role of ROLES) {
        expectProblem(await staff[role].api.post('/api/v1/me/slips/upload', { contentType: 'image/jpeg', sizeBytes: 10 }), 403, 'FORBIDDEN');
      }
      expectProblem(await me.api.get('/api/v1/admin/slips'), 403, 'FORBIDDEN');
      expectProblem(await api(t, tenant.host).post('/api/v1/me/slips/upload', { contentType: 'image/jpeg', sizeBytes: 10 }), 401, 'UNAUTHENTICATED');
    });

    it('accepts own open months, shows "Checking", then processes the photo into a clean JPEG', async () => {
      const me = await learner(tenant, 'Happy class');
      const res = await submit(me, { reference: 'abc 123' });
      expect(res.status).toBe(200);
      expect(res.headers['cache-control']).toBe('no-store');
      const slip = slipSchema.parse(res.body);
      expect(slip).toMatchObject({ status: 'processing', amountCents: 500_000, expectedCents: 500_000, reference: 'abc 123', duplicateOf: null });
      expect(slip.lines.map((l) => l.id).sort()).toEqual([...me.lineIds].sort());
      let fees = myFeesResponseSchema.parse((await me.api.get('/api/v1/me/fees')).body);
      expect(fees.slips).toEqual([expect.objectContaining({ id: slip.id, status: 'processing', rejectReason: null })]);
      expect(fees.openLines.every((l) => l.slipWaiting)).toBe(true);

      await t.jobs.drain();
      fees = myFeesResponseSchema.parse((await me.api.get('/api/v1/me/fees')).body);
      expect(fees.slips[0]?.status).toBe('submitted');
      const [upload] = await withTenant(db, tenant.id, async (tx) =>
        (await tx.execute<{ status: string; object_key: string; processed_key: string }>(
          sql`select u.status::text, u.object_key, u.processed_key from uploads u join bank_slips s on s.upload_id = u.id where s.id = ${slip.id}::uuid`,
        )).rows,
      );
      expect(upload?.status).toBe('processed');
      // Original deleted, processed JPEG stored under the tenant prefix, with no EXIF/GPS.
      expect(storage.objects.has(upload?.object_key ?? '')).toBe(false);
      const processed = storage.contents.get(upload?.processed_key ?? '');
      expect(processed?.contentType).toBe('image/jpeg');
      expect(upload?.processed_key.startsWith(`${tenant.id}/slips/`)).toBe(true);
      const meta = await sharp(processed?.body).metadata();
      expect(meta.format).toBe('jpeg');
      expect(meta.exif).toBeUndefined();
      expect(processed?.body.toString('latin1')).not.toContain('PhoneCam');

      const invoices = await staff.cashier.api.get('/api/v1/admin/invoices?filter=slip_waiting&pageSize=100');
      expect(invoices.status).toBe(200);
      expect((invoices.body.items as { studentId: string; slipWaiting: boolean }[]).filter((i) => i.studentId === me.student.id)).toHaveLength(2);
      expect((invoices.body.items as { slipWaiting: boolean }[]).every((i) => i.slipWaiting)).toBe(true);
    });

    it('converts an HEVC HEIC photo and rejects a renamed non-image as "Unreadable file"', async () => {
      const me = await learner(tenant, 'HEIC class');
      const heic = await submit(me, { lineIds: me.lineIds.slice(0, 1), amountCents: 250_000, body: HEIC });
      expect(heic.status).toBe(200);
      await t.jobs.drain();
      expect((await staff.cashier.api.get(`/api/v1/admin/slips/${heic.body.id}`)).body.status).toBe('submitted');

      const fake = await learner(tenant, 'Fake class');
      const uploadId = await upload(fake, Buffer.from('%PDF-1.7 this is not a photo'), 'image/jpeg');
      const res = await fake.api.post('/api/v1/me/slips', { uploadId, lineIds: fake.lineIds, amountCents: 500_000, reference: 'PDF 1', slipDate: '2026-10-14' });
      expect(res.status).toBe(200);
      await t.jobs.drain();
      const fees = myFeesResponseSchema.parse((await fake.api.get('/api/v1/me/fees')).body);
      expect(fees.slips[0]).toMatchObject({ status: 'rejected', rejectReason: 'Unreadable file' });
      expect(fees.openLines.some((l) => l.slipWaiting)).toBe(false);
      expectProblem(await staff.cashier.api.get(`/api/v1/admin/slips/${res.body.id}/image`), 404, 'NOT_FOUND');
    });

    it("rejects someone else's, another tenant's, expired and reused uploads with one answer", async () => {
      const me = await learner(tenant, 'Owner class');
      const classmate = await learner(tenant, 'Classmate class');
      const foreign = await learner(other, 'Foreign class');
      const body = { lineIds: me.lineIds, amountCents: 500_000, reference: 'REF 1', slipDate: '2026-10-14' };
      const theirs = await upload(classmate, await photo());
      expectProblem(await me.api.post('/api/v1/me/slips', { ...body, uploadId: theirs }), 404, 'NOT_FOUND');
      const foreignUpload = await upload(foreign, await photo());
      expectProblem(await me.api.post('/api/v1/me/slips', { ...body, uploadId: foreignUpload }), 404, 'NOT_FOUND');
      expectProblem(await foreign.api.post('/api/v1/me/slips', { ...body, lineIds: foreign.lineIds, uploadId: await upload(me, await photo()) }), 404, 'NOT_FOUND');

      const stale = await upload(me, await photo());
      t.clock.advance(61 * 60 * 1000);
      expectProblem(await me.api.post('/api/v1/me/slips', { ...body, uploadId: stale }), 404, 'NOT_FOUND');
      const fresh = await upload(me, await photo());
      expect((await me.api.post('/api/v1/me/slips', { ...body, uploadId: fresh })).status).toBe(200);
      expectProblem(await me.api.post('/api/v1/me/slips', { ...body, uploadId: fresh }), 404, 'NOT_FOUND');
      await t.jobs.drain();
    });

    it("refuses other students' months, paid months and impossible dates", async () => {
      const me = await learner(tenant, 'Lines class');
      const classmate = await learner(tenant, 'Lines classmate');
      const res = await submit(me, { lineIds: [classmate.lineIds[0] ?? ''] });
      expectProblem(res, 404, 'NOT_FOUND');
      const foreign = await learner(other, 'Foreign lines');
      expectProblem(await submit(me, { lineIds: [foreign.lineIds[0] ?? ''] }), 404, 'NOT_FOUND');
      const paidLine = me.lineIds[0] ?? '';
      expect((await staff.cashier.api.post('/api/v1/admin/payments/cash', {
        studentId: me.student.id, lineIds: [paidLine], cashReceivedCents: 250_000, idempotencyKey: 'paid-line-cash-0001',
      })).status).toBe(200);
      expectProblem(await submit(me, { lineIds: [paidLine] }), 409, 'ALREADY_PAID');
      const uploadId = await upload(me, await photo());
      for (const slipDate of ['2026-10-16', '2025-01-01']) {
        expectProblem(
          await me.api.post('/api/v1/me/slips', { uploadId, lineIds: me.lineIds.slice(1), amountCents: 1, reference: 'DATE 1', slipDate }),
          400,
          'VALIDATION_FAILED',
        );
      }
    });

    it('a new slip for the same months supersedes the waiting one; a partial overlap is refused', async () => {
      const me = await learner(tenant, 'Supersede class');
      const first = await queued(me, { lineIds: me.lineIds.slice(0, 1), amountCents: 250_000 });
      const second = await queued(me, { lineIds: me.lineIds, amountCents: 500_000 });
      expect((await staff.cashier.api.get(`/api/v1/admin/slips/${first}`)).body.status).toBe('superseded');
      expectProblem(await submit(me, { lineIds: me.lineIds.slice(1), amountCents: 250_000 }), 409, 'CONFLICT');
      expect((await staff.cashier.api.get(`/api/v1/admin/slips/${second}`)).body.status).toBe('submitted');
      // Paid another way: the waiting slip is superseded and leaves the queue.
      expect((await staff.cashier.api.post('/api/v1/admin/payments/cash', {
        studentId: me.student.id, lineIds: me.lineIds.slice(0, 1), cashReceivedCents: 250_000, idempotencyKey: 'supersede-cash-00001',
      })).status).toBe(200);
      expect((await staff.cashier.api.get(`/api/v1/admin/slips/${second}`)).body.status).toBe('superseded');
      expectProblem(await staff.cashier.api.post(`/api/v1/admin/slips/${second}/approve`, {}), 409, 'CONFLICT');
    });
  });

  describe('cashier queue (FEE-06)', () => {
    it('grants the queue to fees.read roles and review to fees.collect roles only', async () => {
      const me = await learner(tenant, 'Roles class');
      const id = await queued(me, { lineIds: me.lineIds.slice(0, 1), amountCents: 250_000 });
      for (const role of ROLES) {
        const allowed = READERS.includes(role);
        for (const path of ['/api/v1/admin/slips', `/api/v1/admin/slips/${id}`, `/api/v1/admin/slips/${id}/image`]) {
          const res = await staff[role].api.get(path);
          if (allowed) expect(res.status, `${role} ${path}`).toBe(200);
          else expectProblem(res, 403, 'FORBIDDEN');
        }
        if (!allowed) {
          expectProblem(await staff[role].api.post(`/api/v1/admin/slips/${id}/approve`, {}), 403, 'FORBIDDEN');
          expectProblem(await staff[role].api.post(`/api/v1/admin/slips/${id}/reject`, { reason: 'Wrong slip' }), 403, 'FORBIDDEN');
        }
      }
      expectProblem(await api(t, tenant.host).get('/api/v1/admin/slips'), 401, 'UNAUTHENTICATED');
      expect((await staff.cashier.api.post(`/api/v1/admin/slips/${id}/reject`, { reason: 'Wrong slip' })).status).toBe(200);
    });

    it('lists oldest first with expected vs written amount, and signs a short-lived inline image URL', async () => {
      const a = await learner(tenant, 'Queue A');
      const b = await learner(tenant, 'Queue B');
      const older = await queued(a, { lineIds: a.lineIds, amountCents: 499_000 });
      t.clock.advance(60_000);
      const newer = await queued(b, { lineIds: b.lineIds.slice(0, 1), amountCents: 250_000 });
      const list = listSlipsResponseSchema.parse((await staff.cashier.api.get('/api/v1/admin/slips?pageSize=100')).body);
      const ids = list.items.map((s) => s.id);
      expect(ids.indexOf(older)).toBeLessThan(ids.indexOf(newer));
      expect(list.items.every((s) => s.status === 'submitted')).toBe(true);
      const slip = list.items.find((s) => s.id === older);
      expect(slip).toMatchObject({ amountCents: 499_000, expectedCents: 500_000, studentId: a.student.id });

      const image = await staff.cashier.api.get(`/api/v1/admin/slips/${older}/image`);
      expect(image.status).toBe(200);
      expect(image.headers['cache-control']).toBe('no-store');
      const signed = signedUrlSchema.parse(image.body);
      expect(new URL(signed.url).pathname.startsWith(`/${tenant.id}/slips/`)).toBe(true);
      const call = storage.callsTo<{ expiresInSec: number; disposition: string }>('createDownloadUrl').at(-1);
      expect(call?.expiresInSec).toBeLessThanOrEqual(600);
      expect(call?.disposition).toBe('inline');
      expect(t.logs.text).not.toContain(signed.url);

      const processing = await submit(b, { lineIds: b.lineIds.slice(1), amountCents: 250_000 });
      expectProblem(await staff.cashier.api.get(`/api/v1/admin/slips/${processing.body.id}/image`), 409, 'CONFLICT');
      expectProblem(await staff.cashier.api.post(`/api/v1/admin/slips/${processing.body.id}/approve`, {}), 409, 'CONFLICT');
      await t.jobs.drain();
    });

    it('approves once: a slip payment for the expected amount with a receipt, even when clicked twice at once', async () => {
      const me = await learner(tenant, 'Approve class');
      const id = await queued(me, { amountCents: 480_000, reference: 'ap 777' });
      const [one, two] = await Promise.all([
        staff.cashier.api.post(`/api/v1/admin/slips/${id}/approve`, {}),
        staff.admin.api.post(`/api/v1/admin/slips/${id}/approve`, {}),
      ]);
      expect([one.status, two.status]).toEqual([200, 200]);
      const slip = slipSchema.parse(one.body);
      expect(slip.status).toBe('approved');
      expect(two.body.status).toBe('approved');
      expect(await scalar<number>(db, tenant.id, sql`select count(*)::int as v from payments where idempotency_key = ${`slip:${id}`}`)).toBe(1);
      const payment = await withTenant(db, tenant.id, async (tx) =>
        (await tx.execute<{ method: string; amount_cents: string; provider_ref: string; receipt: string | null }>(sql`
          select p.method::text, p.amount_cents::text, p.provider_ref, r.id as receipt from payments p
          left join receipts r on r.payment_id = p.id where p.idempotency_key = ${`slip:${id}`}`)).rows[0],
      );
      expect(payment).toMatchObject({ method: 'slip', amount_cents: '500000', provider_ref: 'ap 777' });
      expect(payment?.receipt).toBeTruthy();
      // A third, later click returns the same approved slip without a second payment.
      expect((await staff.cashier.api.post(`/api/v1/admin/slips/${id}/approve`, {})).status).toBe(200);
      expect(await scalar<number>(db, tenant.id, sql`select count(*)::int as v from payments where idempotency_key = ${`slip:${id}`}`)).toBe(1);
      const fees = myFeesResponseSchema.parse((await me.api.get('/api/v1/me/fees')).body);
      expect(fees.openLines).toHaveLength(0);
      expect(fees.slips[0]?.status).toBe('approved');
      expect(fees.payments[0]).toMatchObject({ method: 'slip', amountCents: 500_000 });
      expect(await scalar<number>(db, tenant.id, sql`select count(*)::int as v from audit_logs where action = 'slip.approve' and entity_id = ${id}::uuid`)).toBe(1);
      expectProblem(await staff.cashier.api.post(`/api/v1/admin/slips/${id}/reject`, { reason: 'Too late now' }), 409, 'CONFLICT');
      await assertLedgerInvariants(db, t, tenant);
    });

    it('flags a reused reference and amount, and approves it only with an audited confirmation', async () => {
      const a = await learner(tenant, 'Dup A');
      const b = await learner(tenant, 'Dup B');
      const first = await queued(a, { lineIds: a.lineIds.slice(0, 1), amountCents: 250_000, reference: 'dup 4242' });
      expect((await staff.cashier.api.post(`/api/v1/admin/slips/${first}/approve`, {})).status).toBe(200);
      const second = await queued(b, { lineIds: b.lineIds.slice(0, 1), amountCents: 250_000, reference: 'DUP4242' });
      const shown = slipSchema.parse((await staff.cashier.api.get(`/api/v1/admin/slips/${second}`)).body);
      expect(shown.duplicateOf).toMatchObject({ slipId: first, studentName: 'Nimali Perera' });
      expectProblem(await staff.cashier.api.post(`/api/v1/admin/slips/${second}/approve`, {}), 409, 'CONFLICT');
      expect(await slipCount(tenant.id, sql`id = ${second}::uuid and status = 'submitted'`)).toBe(1);
      const ok = await staff.cashier.api.post(`/api/v1/admin/slips/${second}/approve`, { confirmDuplicate: true });
      expect(ok.status).toBe(200);
      const audit = await scalar<{ confirmDuplicate: boolean; duplicateOf: string }>(
        db, tenant.id, sql`select after as v from audit_logs where action = 'slip.approve' and entity_id = ${second}::uuid`,
      );
      expect(audit).toMatchObject({ confirmDuplicate: true, duplicateOf: first });
      // The student never sees another student's name.
      const mine = await submit(b, { lineIds: b.lineIds.slice(1), amountCents: 250_000, reference: 'dup 4242' });
      expect(mine.body.duplicateOf).toBeNull();
      await t.jobs.drain();
    });

    it('rejects with a reason the student sees, idempotently, and audits it', async () => {
      const me = await learner(tenant, 'Reject class');
      const id = await queued(me);
      expectProblem(await staff.cashier.api.post(`/api/v1/admin/slips/${id}/reject`, { reason: 'no' }), 400, 'VALIDATION_FAILED');
      const res = await staff.cashier.api.post(`/api/v1/admin/slips/${id}/reject`, { reason: 'Amount does not match' });
      expect(res.status).toBe(200);
      expect(slipSchema.parse(res.body)).toMatchObject({ status: 'rejected', rejectReason: 'Amount does not match', reviewedByName: 'cashier user' });
      expect((await staff.cashier.api.post(`/api/v1/admin/slips/${id}/reject`, { reason: 'Amount does not match' })).status).toBe(200);
      expectProblem(await staff.admin.api.post(`/api/v1/admin/slips/${id}/reject`, { reason: 'Another reason' }), 409, 'CONFLICT');
      expectProblem(await staff.cashier.api.post(`/api/v1/admin/slips/${id}/approve`, {}), 409, 'CONFLICT');
      const fees = myFeesResponseSchema.parse((await me.api.get('/api/v1/me/fees')).body);
      expect(fees.slips[0]).toMatchObject({ status: 'rejected', rejectReason: 'Amount does not match' });
      expect(fees.openLines).toHaveLength(2);
      expect(await scalar<number>(db, tenant.id, sql`select count(*)::int as v from audit_logs where action = 'slip.reject' and entity_id = ${id}::uuid`)).toBe(1);
    });

    it("never shows, signs, approves or rejects another tenant's slip", async () => {
      const me = await learner(tenant, 'Isolated class');
      const id = await queued(me);
      expectProblem(await otherOwner.get(`/api/v1/admin/slips/${id}`), 404, 'NOT_FOUND');
      expectProblem(await otherOwner.get(`/api/v1/admin/slips/${id}/image`), 404, 'NOT_FOUND');
      expectProblem(await otherOwner.post(`/api/v1/admin/slips/${id}/approve`, { confirmDuplicate: true }), 404, 'NOT_FOUND');
      expectProblem(await otherOwner.post(`/api/v1/admin/slips/${id}/reject`, { reason: 'Not ours' }), 404, 'NOT_FOUND');
      const list = listSlipsResponseSchema.parse((await otherOwner.get('/api/v1/admin/slips?pageSize=100')).body);
      expect(list.items.map((s) => s.id)).not.toContain(id);
      // The other tenant's session on this tenant's host is refused before any lookup.
      expect((await api(t, tenant.host).get(`/api/v1/admin/slips/${id}`)).status).toBe(401);
      expect(await slipCount(tenant.id, sql`id = ${id}::uuid and status = 'submitted'`)).toBe(1);
      expect(storage.callsTo<{ tenantId: string }>('createDownloadUrl').some((c) => c.tenantId === other.id)).toBe(false);
    });
  });

  describe('media clean-up (ADR 0009)', () => {
    it('deletes unprocessed uploads after 24 h and rejects a slip whose processing never finished', async () => {
      const me = await learner(other, 'Cleanup class');
      const abandoned = await upload(me, await photo());
      const stuck = await upload(me, await photo());
      const res = await me.api.post('/api/v1/me/slips', { uploadId: stuck, lineIds: me.lineIds, amountCents: 500_000, reference: 'STUCK 1', slipDate: '2026-10-14' });
      expect(res.status).toBe(200);
      // Simulate the lost job: drop it from the inline queue before it runs.
      const job = t.jobs.jobs.find((j) => j.queue === 'media' && (j.payload as { uploadId?: string }).uploadId === stuck);
      if (job) job.status = 'failed';
      const runner = t.app.get(MediaJobRunner);
      expect(await runner.cleanup(other.id)).toEqual({ deleted: 0, rejected: 0, requeued: 0 });
      t.clock.advance(24 * 60 * 60 * 1000 + 60_000);
      const keys = await withTenant(db, other.id, async (tx) =>
        (await tx.execute<{ id: string; object_key: string }>(sql`select id, object_key from uploads where id in (${abandoned}::uuid, ${stuck}::uuid)`)).rows,
      );
      // Other tests left unsubmitted uploads in this tenant too; all of them are past 24 h now.
      const cleaned = await runner.cleanup(other.id);
      expect(cleaned.rejected).toBe(1);
      expect(cleaned.deleted).toBeGreaterThanOrEqual(1);
      expect(await scalar<number>(db, other.id, sql`select count(*)::int as v from uploads where id = ${abandoned}::uuid`)).toBe(0);
      for (const k of keys) expect(storage.objects.has(k.object_key)).toBe(false);
      const fees = myFeesResponseSchema.parse((await me.api.get('/api/v1/me/fees')).body);
      expect(fees.slips[0]).toMatchObject({ status: 'rejected', rejectReason: 'Unreadable file' });
      expect(await runner.cleanup(other.id)).toMatchObject({ deleted: 0, rejected: 0 });
    });
  });
});
