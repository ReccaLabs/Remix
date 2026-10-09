import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { creditSmsWallet, schema, withTenant, type Db } from '@remix/db';
import {
  reminderPreviewSchema,
  SMS_SEGMENT_PRICE_CENTS,
  sendRemindersResponseSchema,
  smsWalletSchema,
  type StaffRole,
} from '@remix/types/api';
import { SmsRejectedError } from '../../src/integrations/sms/sms-errors';
import type { SendSmsInput } from '../../src/integrations/sms/sms.provider';
import { JobQueueUnavailableError } from '../../src/jobs/job-producer';
import { FeeRemindersService } from '../../src/modules/sms/fee-reminders.service';
import { SmsWalletService } from '../../src/modules/sms/sms-wallet.service';
import { InsufficientSmsBalanceError, SystemSmsService } from '../../src/modules/sms/system-sms.service';
import { expectProblem } from '../fixtures/problem';
import {
  createDbTestApp,
  Factory,
  ownerDb,
  type DbTestApp,
  type TenantFixture,
  type UserFixture,
} from './support/db-app';
import { feesOf, lines, scalar } from './support/fees';
import { api, signInStaff, signInStudent, staffByRole, type Api } from './support/people';

const FEE = 250_000;
const MONTH = '2026-10-01';
const ROLES: StaffRole[] = ['owner', 'admin', 'cashier', 'teacher', 'gatekeeper'];
const CAN_WALLET: Record<StaffRole, boolean> = { owner: true, admin: false, cashier: false, teacher: false, gatekeeper: false };
const CAN_SEND: Record<StaffRole, boolean> = { owner: true, admin: true, cashier: false, teacher: false, gatekeeper: false };
const WALLET = '/api/v1/admin/sms/wallet';
const PREVIEW = '/api/v1/admin/invoices/reminders/preview';
const SEND = '/api/v1/admin/invoices/reminders/send';
let keyCounter = 0;
const key = (label: string) => `${label}-${Date.now().toString(36)}-${++keyCounter}`.padEnd(16, 'x');

describe('MSG-01/02/04, FEE-02/12: SMS wallet, system SMS and reminders against Postgres', () => {
  let t: DbTestApp;
  let db: Db;
  let f: Factory;
  let tenant: TenantFixture;
  let other: TenantFixture;
  let staff: Record<StaffRole, { user: UserFixture; api: Api }>;
  let otherStaff: Record<StaffRole, { user: UserFixture; api: Api }>;
  let students: UserFixture[];
  let classId: string;
  let otherStudent: UserFixture;

  const credit = (tn: TenantFixture, amountCents: number) =>
    creditSmsWallet(db, { slug: tn.slug, amountCents, note: 'integration test credit' });
  const balance = (tn: TenantFixture) =>
    scalar<number>(db, tn.id, sql`select coalesce(max(balance_cents), 0)::int as v from sms_wallets`);
  const ledgerCount = (tn: TenantFixture, kind?: string) =>
    scalar<number>(db, tn.id, kind ? sql`select count(*)::int as v from sms_wallet_ledger where kind = ${kind}` : sql`select count(*)::int as v from sms_wallet_ledger`);
  const statusOf = (tn: TenantFixture, messageId: string) =>
    scalar<string>(db, tn.id, sql`select status as v from sms_messages where message_id = ${messageId}`);
  const queuedSms = () => t.jobs.of('sms').length;
  const sent = () => t.sms.callsTo<SendSmsInput>('send');
  /** Wallet-billed fee reminders only (sign-in codes to the same tenant are not). */
  const reminderSms = (tn: TenantFixture) => sent().filter((m) => m.tenantId === tn.id && / fee of /.test(m.text));
  /** Drain the queue and drop the recorded calls so each test counts only its own messages. */
  const settle = async () => {
    await t.jobs.drain();
  };

  async function seedStudent(tn: TenantFixture, name: string, klass: string, month = '2026-10') {
    const s = await f.student(tn, { name });
    await f.enroll(tn, s.id, klass, { from: '2026-09-01' });
    await feesOf(t).generateInvoices(tn.id, month);
    return s;
  }

  beforeAll(async () => {
    t = await createDbTestApp();
    db = ownerDb();
    f = new Factory(db);
    tenant = await f.tenant('active');
    other = await f.tenant('active');
    staff = await staffByRole(t, f, tenant);
    otherStaff = await staffByRole(t, f, other);
    classId = await f.klass(tenant, { name: 'Physics', feeCents: FEE });
    students = [];
    for (const name of ['Nimal Silva', 'Kamala Perera', 'Sunil Fernando']) students.push(await seedStudent(tenant, name, classId));
    const otherClass = await f.klass(other, { name: 'Chemistry', feeCents: FEE });
    otherStudent = await seedStudent(other, 'Other Tenant Student', otherClass);
  });
  afterAll(async () => {
    await t.close();
    await db.$client.end();
  });

  describe('endpoints per role', () => {
    for (const role of ROLES) {
      it(`${role}: wallet read and top-up request are ${CAN_WALLET[role] ? 'allowed' : 'forbidden'}`, async () => {
        const read = await staff[role].api.get(WALLET);
        if (CAN_WALLET[role]) {
          expect(read.status).toBe(200);
          const body = smsWalletSchema.strict().parse(read.body);
          expect(body).toMatchObject({ segmentPriceCents: SMS_SEGMENT_PRICE_CENTS, senderId: null });
          expect(read.headers['cache-control']).toBe('no-store');
        } else {
          expectProblem(read, 403, 'FORBIDDEN');
          const before = await scalar<number>(db, tenant.id, sql`select count(*)::int as v from sms_top_up_requests`);
          expectProblem(await staff[role].api.post('/api/v1/admin/sms/wallet/top-up', { amountCents: 200_000 }), 403, 'FORBIDDEN');
          expect(await scalar<number>(db, tenant.id, sql`select count(*)::int as v from sms_top_up_requests`)).toBe(before);
        }
      });

      it(`${role}: reminder preview and send are ${CAN_SEND[role] ? 'allowed' : 'forbidden'}`, async () => {
        const target = { month: MONTH, filter: 'unpaid' as const };
        const preview = await staff[role].api.post(PREVIEW, target);
        const send = await staff[role].api.post(SEND, { ...target, idempotencyKey: key(`role-${role}`) });
        if (CAN_SEND[role]) {
          expect(preview.status).toBe(200);
          reminderPreviewSchema.strict().parse(preview.body);
          // No wallet credit here: the send is refused for balance, not for permission.
          expectProblem(send, 409, 'INSUFFICIENT_BALANCE');
        } else {
          expectProblem(preview, 403, 'FORBIDDEN');
          expectProblem(send, 403, 'FORBIDDEN');
        }
      });
    }

    it('anonymous callers and students are refused', async () => {
      const cookie = await signInStudent(t, tenant, students[0]!);
      for (const client of [api(t, tenant.host), api(t, tenant.host, cookie)]) {
        expect([401, 403]).toContain((await client.get(WALLET)).status);
        expect([401, 403]).toContain((await client.post(PREVIEW, { month: MONTH, filter: 'unpaid' })).status);
        expect([401, 403]).toContain((await client.post(SEND, { month: MONTH, filter: 'unpaid', idempotencyKey: key('anon') })).status);
        expect([401, 403]).toContain((await client.post('/api/v1/admin/sms/wallet/top-up', { amountCents: 200_000 })).status);
      }
    });

    it('rejects unknown fields and bad amounts', async () => {
      expect((await staff.owner.api.post('/api/v1/admin/sms/wallet/top-up', { amountCents: 500 })).status).toBe(400);
      expect((await staff.owner.api.post('/api/v1/admin/sms/wallet/top-up', { amountCents: 200_000, extra: 1 })).status).toBe(400);
      expect((await staff.owner.api.post(SEND, { month: MONTH, filter: 'unpaid', idempotencyKey: 'short' })).status).toBe(400);
      expect((await staff.owner.api.post(PREVIEW, { month: '2026-10', filter: 'unpaid' })).status).toBe(400);
    });
  });

  describe('Buy SMS request (MSG-02)', () => {
    it('files an audited request, caps open requests, and staff credit settles it', async () => {
      const t2 = await f.tenant('active');
      const owner2 = (await staffByRole(t, f, t2, ['owner'])).owner;
      for (let i = 0; i < 3; i += 1) {
        expect((await owner2.api.post('/api/v1/admin/sms/wallet/top-up', { amountCents: 200_000 })).status).toBe(204);
      }
      expectProblem(await owner2.api.post('/api/v1/admin/sms/wallet/top-up', { amountCents: 200_000 }), 409, 'CONFLICT');
      expect((await owner2.api.get(WALLET)).body.openTopUpRequests).toBe(3);
      expect(await f.audits(t2, 'sms.top_up_request')).toHaveLength(3);
      const [request] = (await withTenant(db, t2.id, (tx) => tx.execute<{ id: string }>(sql`select id from sms_top_up_requests order by created_at limit 1`))).rows;
      await creditSmsWallet(db, { slug: t2.slug, amountCents: 200_000, note: 'Invoice 42 paid', requestId: request?.id });
      const wallet = smsWalletSchema.strict().parse((await owner2.api.get(WALLET)).body);
      expect(wallet).toMatchObject({ balanceCents: 200_000, openTopUpRequests: 2, lowBalance: false });
      expect(wallet.recent[0]).toMatchObject({ kind: 'top_up', amountCents: 200_000, balanceAfterCents: 200_000 });
    });
  });

  describe('system SMS: debit before queueing, idempotent, refunded on failure', () => {
    let tn: TenantFixture;
    let sms: SystemSmsService;
    beforeAll(async () => {
      tn = await f.tenant('active');
      sms = t.app.get(SystemSmsService);
    });
    const phone = () => students[0]!.phone;

    it('rejects a send with no balance and queues nothing', async () => {
      const queuedBefore = queuedSms();
      await expect(sms.send(tn.id, 'slip_approved', { months: 'Oct 2026', receiptNo: 'R-1' }, phone(), key('nobal'))).rejects.toBeInstanceOf(InsufficientSmsBalanceError);
      expect(queuedSms()).toBe(queuedBefore);
      expect(await ledgerCount(tn)).toBe(0);
    });

    it('debits segments x price, queues once, and a repeated key neither charges nor sends again', async () => {
      await credit(tn, 10_000);
      const k = key('once');
      const first = await sms.send(tn.id, 'slip_rejected', { reason: 'Blurry image' }, phone(), k);
      expect(first).toMatchObject({ status: 'queued', segments: 1, costCents: SMS_SEGMENT_PRICE_CENTS });
      expect(await balance(tn)).toBe(10_000 - SMS_SEGMENT_PRICE_CENTS);
      const again = await sms.send(tn.id, 'slip_rejected', { reason: 'Blurry image' }, phone(), k);
      expect(again.status).toBe('replayed');
      expect(await balance(tn)).toBe(10_000 - SMS_SEGMENT_PRICE_CENTS);
      expect(await ledgerCount(tn, 'send')).toBe(1);
      await settle();
      const delivered = sent().filter((m) => m.idempotencyKey === `${tn.id}:${k}`);
      expect(delivered).toHaveLength(1);
      expect(delivered[0]?.text).toContain('Blurry image');
      expect(await statusOf(tn, k)).toBe('sent');
    });

    it('refunds immediately on a definite gateway rejection and stops retrying', async () => {
      const before = await balance(tn);
      const k = key('reject');
      t.sms.failNext(new SmsRejectedError('notify.lk', 'invalid number'));
      await sms.send(tn.id, 'slip_approved', { months: 'Oct 2026', receiptNo: 'R-2' }, phone(), k);
      expect(await balance(tn)).toBe(before - SMS_SEGMENT_PRICE_CENTS);
      await settle();
      expect(await balance(tn)).toBe(before);
      expect(await statusOf(tn, k)).toBe('failed');
      expect(await ledgerCount(tn, 'refund')).toBe(1);
      expect(t.jobs.jobs.find((j) => j.jobId.endsWith(k))?.attempts).toBe(1);
    });

    it('retries transient failures and refunds only after the last attempt', async () => {
      const before = await balance(tn);
      const k = key('transient');
      for (let i = 0; i < 5; i += 1) t.sms.failNext(new Error('gateway down'));
      await sms.send(tn.id, 'slip_approved', { months: 'Oct 2026', receiptNo: 'R-3' }, phone(), k);
      await settle();
      expect(t.jobs.jobs.find((j) => j.jobId.endsWith(k))?.attempts).toBe(5);
      expect(await balance(tn)).toBe(before);
      expect(await statusOf(tn, k)).toBe('failed');
    });

    it('a transient failure that recovers is delivered, debited once, and never refunded', async () => {
      const before = await balance(tn);
      const k = key('recover');
      t.sms.failNext(new Error('blip'));
      await sms.send(tn.id, 'slip_approved', { months: 'Oct 2026', receiptNo: 'R-4' }, phone(), k);
      await settle();
      expect(await balance(tn)).toBe(before - SMS_SEGMENT_PRICE_CENTS);
      expect(await statusOf(tn, k)).toBe('sent');
    });

    it('refunds when the queue is unavailable', async () => {
      const before = await balance(tn);
      const original = t.jobs.add.bind(t.jobs);
      t.jobs.add = () => Promise.reject(new JobQueueUnavailableError());
      const k = key('queuedown');
      try {
        await expect(sms.send(tn.id, 'slip_approved', { months: 'Oct 2026', receiptNo: 'R-5' }, phone(), k)).rejects.toBeInstanceOf(JobQueueUnavailableError);
      } finally {
        t.jobs.add = original;
      }
      expect(await balance(tn)).toBe(before);
      expect(await statusOf(tn, k)).toBe('failed');
    });

    it('stale debited-but-never-queued messages are refunded by the sweep', async () => {
      const wallet = t.app.get(SmsWalletService);
      const before = await balance(tn);
      const k = key('stale');
      await withTenant(db, tn.id, async (tx) => {
        await wallet.charge(tx, tn.id, { messageId: k, template: 'slip_approved', segments: 1 });
      });
      expect(await balance(tn)).toBe(before - SMS_SEGMENT_PRICE_CENTS);
      t.clock.advance(31 * 60_000);
      expect(await wallet.refundStalePending(tn.id)).toBe(1);
      expect(await balance(tn)).toBe(before);
      expect(await wallet.refundStalePending(tn.id)).toBe(0);
    });

    it('concurrent sends never overdraw the wallet, and the same key concurrently charges once', async () => {
      const t3 = await f.tenant('active');
      await credit(t3, SMS_SEGMENT_PRICE_CENTS * 4);
      const results = await Promise.allSettled(
        Array.from({ length: 10 }, (_, i) => sms.send(t3.id, 'slip_approved', { months: 'Oct 2026', receiptNo: `C-${i}` }, phone(), key(`race${i}`))),
      );
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(4);
      for (const r of results) if (r.status === 'rejected') expect(r.reason).toBeInstanceOf(InsufficientSmsBalanceError);
      expect(await balance(t3)).toBe(0);
      await credit(t3, 10_000);
      const same = key('same');
      const outcomes = await Promise.all(
        Array.from({ length: 5 }, () => sms.send(t3.id, 'slip_approved', { months: 'Oct 2026', receiptNo: 'S-1' }, phone(), same)),
      );
      expect(outcomes.filter((o) => o.status === 'queued')).toHaveLength(1);
      expect(await ledgerCount(t3, 'send')).toBe(5);
    });

    it('flags a low balance once, with one audit row', async () => {
      const t4 = await f.tenant('active');
      const owner4 = (await staffByRole(t, f, t4, ['owner'])).owner;
      await credit(t4, 30_000);
      await creditSmsWallet(db, { slug: t4.slug, lowBalanceThresholdCents: 29_000 });
      for (let i = 0; i < 20; i += 1) await sms.send(t4.id, 'slip_approved', { months: 'Oct 2026', receiptNo: `L-${i}` }, phone(), key(`low${i}`));
      const wallet = smsWalletSchema.parse((await owner4.api.get(WALLET)).body);
      expect(wallet.lowBalance).toBe(true);
      expect(await f.audits(t4, 'sms.low_balance')).toHaveLength(1);
      await credit(t4, 100_000);
      expect(smsWalletSchema.parse((await owner4.api.get(WALLET)).body).lowBalance).toBe(false);
    });

    it('OTP and sign-in SMS are platform cost: never debited', async () => {
      const t5 = await f.tenant('active');
      await credit(t5, 5_000);
      const ledgerBefore = await ledgerCount(t5);
      const owner5 = await f.staff(t5, ['owner']);
      await signInStaff(t, t5, owner5); // two-step code by SMS
      const student = await f.student(t5);
      await signInStudent(t, t5, student);
      expect(await balance(t5)).toBe(5_000);
      expect(await ledgerCount(t5)).toBe(ledgerBefore);
      expect(sent().some((m) => m.to === owner5.phone)).toBe(true);
    });
  });

  describe('manual reminders (FEE-02)', () => {
    let tn: TenantFixture;
    let owner: Api;
    let ids: UserFixture[];
    beforeAll(async () => {
      tn = await f.tenant('active');
      owner = (await staffByRole(t, f, tn, ['owner'])).owner.api;
      const k = await f.klass(tn, { name: 'Maths', feeCents: FEE });
      ids = [];
      for (const name of ['Amara Silva', 'Bimal Jayawardena']) ids.push(await seedStudent(tn, name, k));
    });

    it('previews recipients, segments, cost, balance and a sample text', async () => {
      const res = await owner.post(PREVIEW, { month: MONTH, filter: 'unpaid' });
      const preview = reminderPreviewSchema.strict().parse(res.body);
      expect(preview).toMatchObject({ recipients: 2, segments: 2, costCents: 2 * SMS_SEGMENT_PRICE_CENTS, balanceCents: 0 });
      expect(preview.sampleText).toMatch(/LKR 2,500 was due on 5 Oct and is unpaid/);
      expect(preview.sampleText).toContain(`Test ${tn.slug}`);
    });

    it('409s without balance and queues, debits and records nothing', async () => {
      const queuedBefore = queuedSms();
      const res = await owner.post(SEND, { month: MONTH, filter: 'unpaid', idempotencyKey: key('short') });
      expectProblem(res, 409, 'INSUFFICIENT_BALANCE');
      expect(queuedSms()).toBe(queuedBefore);
      expect(await ledgerCount(tn)).toBe(0);
      expect(await scalar<number>(db, tn.id, sql`select count(*)::int as v from sms_messages`)).toBe(0);
    });

    it('sends to the guardian who opted in (else the student), once per idempotency key', async () => {
      await credit(tn, 10_000);
      const guardianPhone = '+94771110001';
      await withTenant(db, tn.id, async (tx) => {
        await tx.insert(schema.guardians).values([
          { tenantId: tn.id, studentId: ids[0]!.id, name: 'Opted Out', relation: 'father', phone: '+94771110002', smsOptIn: false },
          { tenantId: tn.id, studentId: ids[0]!.id, name: 'Mother', relation: 'mother', phone: guardianPhone, smsOptIn: true },
        ]);
      });
      const k = key('send');
      const res = await owner.post(SEND, { month: MONTH, filter: 'overdue', idempotencyKey: k });
      expect(res.status).toBe(200);
      expect(sendRemindersResponseSchema.strict().parse(res.body)).toEqual({ queued: 2, costCents: 2 * SMS_SEGMENT_PRICE_CENTS });
      expect(await balance(tn)).toBe(10_000 - 2 * SMS_SEGMENT_PRICE_CENTS);
      await settle();
      const recipients = reminderSms(tn).map((m) => m.to).sort();
      expect(recipients).toEqual([guardianPhone, ids[1]!.phone].sort());
      // Same key: same answer, nothing more charged or sent.
      const repeat = await owner.post(SEND, { month: MONTH, filter: 'overdue', idempotencyKey: k });
      expect(repeat.body).toEqual(res.body);
      await settle();
      expect(await balance(tn)).toBe(10_000 - 2 * SMS_SEGMENT_PRICE_CENTS);
      expect(reminderSms(tn)).toHaveLength(2);
      expect(await f.audits(tn, 'sms.reminders_send')).toHaveLength(1);
      // A new key is a deliberate second reminder.
      expect((await owner.post(SEND, { month: MONTH, filter: 'overdue', idempotencyKey: key('again') })).status).toBe(200);
      expect(await balance(tn)).toBe(10_000 - 4 * SMS_SEGMENT_PRICE_CENTS);
    });

    it('skips paid invoices and honours the class filter', async () => {
      const k2 = await f.klass(tn, { name: 'Biology', feeCents: FEE });
      const lone = await seedStudent(tn, 'Chamari Lone', k2);
      const l = (await lines(db, tn.id)).find((x) => x.student_id === lone.id)!;
      await feesOf(t).recordPayment(tn.id, { method: 'cash', amountCents: FEE, lines: [l.id], idempotencyKey: key('paylone'), receivedBy: null });
      const preview = reminderPreviewSchema.parse((await owner.post(PREVIEW, { month: MONTH, filter: 'unpaid', classId: k2 })).body);
      expect(preview.recipients).toBe(0);
    });
  });

  describe('cross-tenant isolation', () => {
    it("tenant B's staff see their own wallet, students and ledger only", async () => {
      await credit(other, 7_000);
      const mine = smsWalletSchema.parse((await otherStaff.owner.api.get(WALLET)).body);
      const theirs = smsWalletSchema.parse((await staff.owner.api.get(WALLET)).body);
      expect(mine.balanceCents).toBe(7_000);
      expect(theirs.balanceCents).not.toBe(7_000);
      expect(mine.recent.every((e) => e.kind === 'top_up')).toBe(true);
      const preview = reminderPreviewSchema.parse((await otherStaff.owner.api.post(PREVIEW, { month: MONTH, filter: 'unpaid' })).body);
      expect(preview.recipients).toBe(1);
      const queuedBefore = reminderSms(other).length;
      const res = await otherStaff.owner.api.post(SEND, { month: MONTH, filter: 'unpaid', idempotencyKey: key('b') });
      expect(res.status).toBe(200);
      await settle();
      const newOnes = reminderSms(other).slice(queuedBefore);
      expect(newOnes.map((m) => m.to)).toEqual([otherStudent.phone]);
      expect(newOnes.every((m) => m.tenantId === other.id)).toBe(true);
      expect(await balance(other)).toBe(7_000 - SMS_SEGMENT_PRICE_CENTS);
    });
  });

  describe('receipt SMS (MSG-04)', () => {
    let tn: TenantFixture;
    let owner: Api;
    let student: UserFixture;
    let lineIds: string[];
    beforeAll(async () => {
      tn = await f.tenant('active');
      owner = (await staffByRole(t, f, tn, ['owner'])).owner.api;
      const k = await f.klass(tn, { name: 'English', feeCents: FEE });
      student = await f.student(tn, { name: 'Dilini Perera' });
      for (const m of ['2026-09', '2026-10']) {
        await f.enroll(tn, student.id, k, { from: '2026-08-01' }).catch(() => undefined);
        await feesOf(t).generateInvoices(tn.id, m);
      }
      lineIds = (await lines(db, tn.id)).map((l) => l.id);
    });
    const pay = (lineId: string, label: string) =>
      feesOf(t).recordPayment(tn.id, { method: 'cash', amountCents: FEE, lines: [lineId], idempotencyKey: key(label), receivedBy: null });
    const receiptSms = () => sent().filter((m) => m.tenantId === tn.id && m.text.includes('received for'));

    it('sends nothing while the setting is off', async () => {
      await credit(tn, 5_000);
      await pay(lineIds[0]!, 'off');
      await settle();
      expect(receiptSms()).toHaveLength(0);
      expect(await balance(tn)).toBe(5_000);
    });

    it('texts the receipt to the student when on, idempotently', async () => {
      expect((await owner.patch('/api/v1/admin/settings/fees', { receiptSmsEnabled: true })).body.receiptSmsEnabled).toBe(true);
      const paid = await pay(lineIds[1]!, 'on');
      await settle();
      expect(receiptSms()).toHaveLength(1);
      const sms = receiptSms()[0]!;
      expect(sms.to).toBe(student.phone);
      expect(sms.text).toMatch(/LKR 2,500\.00 received for Dilini Perera\. Receipt [A-Z]+-R-26-\d{5}\./);
      expect(await balance(tn)).toBe(5_000 - SMS_SEGMENT_PRICE_CENTS);
      expect(await statusOf(tn, `receipt-${paid.payment.id}`)).toBe('sent');
      // The replayed payment (same idempotency key) is not a new receipt, so no second SMS.
      await feesOf(t).recordPayment(tn.id, { method: 'cash', amountCents: FEE, lines: [lineIds[1]!], idempotencyKey: key('on'), receivedBy: null }).catch(() => undefined);
      await settle();
      expect(receiptSms()).toHaveLength(1);
    });

    it('prefers an SMS-opted-in guardian and skips quietly when the wallet is empty', async () => {
      const t6 = await f.tenant('active');
      const owner6 = (await staffByRole(t, f, t6, ['owner'])).owner.api;
      const k = await f.klass(t6, { name: 'ICT', feeCents: FEE });
      const s = await f.student(t6, { name: 'Eranga Wije' });
      await f.enroll(t6, s.id, k, { from: '2026-09-01' });
      await feesOf(t).generateInvoices(t6.id, '2026-10');
      await withTenant(db, t6.id, (tx) => tx.insert(schema.guardians).values({ tenantId: t6.id, studentId: s.id, name: 'Dad', relation: 'father', phone: '+94772220001', smsOptIn: true }));
      await owner6.patch('/api/v1/admin/settings/fees', { receiptSmsEnabled: true });
      const [line] = await lines(db, t6.id);
      // Empty wallet: the payment still succeeds and no SMS is queued or charged.
      const before = queuedSms();
      const paid = await feesOf(t).recordPayment(t6.id, { method: 'cash', amountCents: FEE, lines: [line!.id], idempotencyKey: key('empty'), receivedBy: null });
      expect(paid.receiptId).toBeTruthy();
      expect(queuedSms()).toBe(before);
      expect(await ledgerCount(t6)).toBe(0);
      // With credit the guardian gets the next receipt.
      await credit(t6, 1_000);
      await f.enroll(t6, s.id, await f.klass(t6, { name: 'ICT 2', feeCents: FEE }), { from: '2026-09-01' });
      await feesOf(t).generateInvoices(t6.id, '2026-10');
      const next = (await lines(db, t6.id)).find((l) => l.id !== line!.id)!;
      await feesOf(t).recordPayment(t6.id, { method: 'cash', amountCents: FEE, lines: [next.id], idempotencyKey: key('guardian'), receivedBy: null });
      await settle();
      expect(sent().filter((m) => m.tenantId === t6.id && m.text.includes('received for')).map((m) => m.to)).toEqual(['+94772220001']);
    });
  });

  describe('automatic reminders (FEE-12)', () => {
    let tn: TenantFixture;
    let owner: Api;
    let ids: UserFixture[];
    let reminders: FeeRemindersService;
    beforeAll(async () => {
      reminders = t.app.get(FeeRemindersService);
      tn = await f.tenant('active');
      owner = (await staffByRole(t, f, tn, ['owner'])).owner.api;
      const k = await f.klass(tn, { name: 'History', feeCents: FEE });
      ids = [];
      for (const name of ['Farah Khan', 'Gayan Ranasinghe']) ids.push(await seedStudent(tn, name, k));
      await credit(tn, 20_000);
    });
    const mine = () => reminderSms(tn);

    it('does nothing while reminders are off', async () => {
      expect(await reminders.runAutomatic(tn.id, '2026-10-06')).toMatchObject({ sent: 0, candidates: 0 });
    });

    it('sends the overdue reminder remindAfterDays after the due date, and a second run sends nothing', async () => {
      await owner.patch('/api/v1/admin/settings/fees', { remindersEnabled: true, remindAfterDays: 3, remindBeforeDays: 2 });
      // Due 5 Oct: nothing on the 7th, the 8th is due + 3.
      expect((await reminders.runAutomatic(tn.id, '2026-10-07')).sent).toBe(0);
      const first = await reminders.runAutomatic(tn.id, '2026-10-08');
      expect(first).toMatchObject({ candidates: 2, sent: 2, stoppedForBalance: false });
      await settle();
      expect(mine()).toHaveLength(2);
      expect(mine()[0]?.text).toMatch(/fee of LKR 2,500 was due on 5 Oct and is unpaid/);
      const second = await reminders.runAutomatic(tn.id, '2026-10-08');
      expect(second.sent).toBe(0);
      await settle();
      expect(mine()).toHaveLength(2);
      expect(await balance(tn)).toBe(20_000 - 2 * SMS_SEGMENT_PRICE_CENTS);
    });

    it('sends the before-due reminder remindBeforeDays ahead', async () => {
      const first = await reminders.runAutomatic(tn.id, '2026-10-03');
      expect(first.sent).toBe(2);
      await settle();
      expect(mine().filter((m) => m.text.includes('is due on 5 Oct'))).toHaveLength(2);
      expect((await reminders.runAutomatic(tn.id, '2026-10-03')).sent).toBe(0);
    });

    it('skips students who paid, and stops (without error) when the wallet runs out', async () => {
      const t7 = await f.tenant('active');
      const owner7 = (await staffByRole(t, f, t7, ['owner'])).owner.api;
      const k = await f.klass(t7, { name: 'Art', feeCents: FEE });
      const a = await seedStudent(t7, 'Hasini A', k);
      await seedStudent(t7, 'Hasini B', k);
      await seedStudent(t7, 'Hasini C', k);
      await owner7.patch('/api/v1/admin/settings/fees', { remindersEnabled: true });
      const l = (await lines(db, t7.id)).find((x) => x.student_id === a.id)!;
      await feesOf(t).recordPayment(t7.id, { method: 'cash', amountCents: FEE, lines: [l.id], idempotencyKey: key('paida'), receivedBy: null });
      await credit(t7, SMS_SEGMENT_PRICE_CENTS);
      const run = await reminders.runAutomatic(t7.id, '2026-10-06');
      expect(run).toMatchObject({ candidates: 2, sent: 1, stoppedForBalance: true });
      expect(await balance(t7)).toBe(0);
    });
  });

  it('fee settings carry the receipt-SMS switch', async () => {
    const res = await staff.owner.api.get('/api/v1/admin/settings/fees');
    expect(res.body.receiptSmsEnabled).toBe(false);
    expectProblem(await staff.admin.api.patch('/api/v1/admin/settings/fees', { receiptSmsEnabled: true }), 403, 'FORBIDDEN');
  });
});
