import type { Page } from '@playwright/test';
import { createOwnerDb, creditSmsWallet, schema, withTenant, type Tx } from '../../packages/db/src';
import { DATABASE_URL } from './env';

/**
 * DEV/TEST only helpers for the Phase 3 money journeys. They talk to the dev/CI database as the
 * owner role (like cash-fixture.ts), always inside `withTenant` so row-level security still
 * applies, and never reset or delete data: invoice rows are appended idempotently and payments
 * are undone through the public reversal API, which keeps the append-only history.
 */
const SLUG = 'kamalphysics';

export async function withKamal<T>(fn: (tx: Tx, tenantId: string, prefix: string) => Promise<T>): Promise<T> {
  const url = new URL(DATABASE_URL);
  url.username = 'remix_owner';
  url.password = 'remix_owner_dev_password';
  const db = createOwnerDb(url.toString());
  try {
    const tenant = await db.query.tenants.findFirst({ where: (t, { eq }) => eq(t.slug, SLUG) });
    if (!tenant) throw new Error('Seed the development tenants before the money journeys');
    return await withTenant(db, tenant.id, (tx) => fn(tx, tenant.id, tenant.studentNoPrefix));
  } finally {
    await db.$client.end();
  }
}

/** First day of the Asia/Colombo month `offset` months from now, as `YYYY-MM-01`. */
export function colomboMonth(offset = 0): string {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Colombo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const [year, month] = today.split('-').map(Number) as [number, number];
  const index = year * 12 + (month - 1) + offset;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}-01`;
}

/** Credit the journey tenant's SMS wallet (staff tooling `pnpm tenant:sms-credit`, as the owner role). */
export async function creditWallet(amountCents: number): Promise<void> {
  const url = new URL(DATABASE_URL);
  url.username = 'remix_owner';
  url.password = 'remix_owner_dev_password';
  const db = createOwnerDb(url.toString());
  try {
    await creditSmsWallet(db, { slug: SLUG, amountCents, note: 'E2E journey credit' });
  } finally {
    await db.$client.end();
  }
}

export async function walletBalance(): Promise<number> {
  return withKamal(async (tx) => (await tx.query.smsWallets.findFirst())?.balanceCents ?? 0);
}

/** The state of one wallet-billed SMS (`sms_messages`): the business key is e.g. `receipt-<paymentId>`. */
export async function smsMessage(messageId: string) {
  return withKamal(async (tx) => tx.query.smsMessages.findFirst({ where: (m, { eq }) => eq(m.messageId, messageId) }));
}

/** Where fee SMS go: the first guardian who opted in to SMS, else the student's own mobile. */
export async function smsRecipient(studentId: string): Promise<string> {
  return withKamal(async (tx) => {
    const guardians = await tx.query.guardians.findMany({ where: (g, { and, eq }) => and(eq(g.studentId, studentId), eq(g.smsOptIn, true)), orderBy: (g, { asc }) => [asc(g.createdAt), asc(g.id)] });
    const guardian = guardians.find((g) => /^\+947\d{8}$/.test(g.phone));
    if (guardian) return guardian.phone;
    const user = await tx.query.tenantUsers.findFirst({ where: (u, { eq }) => eq(u.id, studentId) });
    if (!user || !/^\+947\d{8}$/.test(user.phone ?? '')) throw new Error('Journey student has no SMS recipient');
    return user.phone as string;
  });
}

export interface JourneyStudent {
  studentId: string;
  name: string;
  /** E.164, as stored. */
  phone: string;
  studentNo: string;
  className: string;
  classId: string;
  /** `invoice_lines.id` per requested month, in the order of `months`. */
  lineIds: string[];
  months: string[];
  /** Fee per month. */
  feeCents: number;
}

/**
 * Finds seeded active students (numbers `from`..`from + 29`, phone `+9471` + 7 digits) with an open
 * enrolment and a fee, and appends an invoice with one line per month for each. Idempotent: a retry
 * after a failed attempt finds the same rows. A student is used by one journey only (the login
 * limiter and shared state), so every journey passes its own `from`.
 */
export async function prepareStudents(opts: { from: number; count: number; months: string[]; dueDay?: number }): Promise<JourneyStudent[]> {
  return withKamal(async (tx, tenantId, prefix) => {
    const found: JourneyStudent[] = [];
    for (let n = opts.from; n < opts.from + 30 && found.length < opts.count; n++) {
      const phone = `+9471${String(n).padStart(7, '0')}`;
      const user = await tx.query.tenantUsers.findFirst({ where: (u, { and, eq }) => and(eq(u.phone, phone), eq(u.kind, 'student'), eq(u.status, 'active')) });
      if (!user) continue;
      const student = await tx.query.students.findFirst({ where: (s, { eq }) => eq(s.userId, user.id) });
      if (!student || student.archivedAt) continue;
      const enrollments = await tx.query.enrollments.findMany({ where: (e, { and, eq, isNull }) => and(eq(e.studentId, user.id), isNull(e.toMonth)) });
      for (const enrollment of enrollments) {
        const klass = await tx.query.classes.findFirst({ where: (c, { eq }) => eq(c.id, enrollment.classId) });
        const fee = enrollment.feeOverrideCents ?? klass?.feeCents ?? 0;
        if (!klass || fee <= 0 || enrollment.fromMonth > opts.months[0]!) continue;
        const lineIds: string[] = [];
        for (const month of opts.months) {
          const dueOn = `${month.slice(0, 7)}-${String(opts.dueDay ?? 5).padStart(2, '0')}`;
          await tx.insert(schema.invoices).values({ tenantId, studentId: user.id, number: `${prefix}-I-${month.slice(2, 7)}-${student.studentNo}`, month, dueOn }).onConflictDoNothing();
          const invoice = await tx.query.invoices.findFirst({ where: (i, { and, eq }) => and(eq(i.studentId, user.id), eq(i.month, month)) });
          if (!invoice) throw new Error('Journey invoice missing');
          await tx.insert(schema.invoiceLines).values({ tenantId, invoiceId: invoice.id, enrollmentId: enrollment.id, classId: klass.id, month, amountCents: fee }).onConflictDoNothing();
          const line = await tx.query.invoiceLines.findFirst({ where: (l, { and, eq }) => and(eq(l.enrollmentId, enrollment.id), eq(l.month, month)) });
          if (!line) throw new Error('Journey line missing');
          lineIds.push(line.id);
        }
        found.push({ studentId: user.id, name: user.displayName, phone, studentNo: student.studentNo, className: klass.name, classId: klass.id, lineIds, months: opts.months, feeCents: fee });
        break;
      }
    }
    if (found.length < opts.count) throw new Error(`Only ${found.length} of ${opts.count} seeded students fit the money journey (from ${opts.from})`);
    return found;
  });
}

/**
 * The unlock rule of ADR 0008 §3 (`canAccess`, apps/api/src/modules/fees/access.ts), read straight
 * from the database: the student's line for that class and month exists, is not voided, and its
 * allocations cover the amount. Phases 4-5 will call the API function before issuing lesson tokens
 * and Zoom joins; until then this is how a journey observes "locked" and "unlocked".
 */
export async function monthUnlocked(studentId: string, classId: string, month: string): Promise<boolean> {
  return withKamal(async (tx) => {
    const lines = await tx.query.invoiceLines.findMany({ where: (l, { and, eq, isNull }) => and(eq(l.classId, classId), eq(l.month, month), isNull(l.voidedAt)) });
    for (const line of lines) {
      const invoice = await tx.query.invoices.findFirst({ where: (i, { and, eq }) => and(eq(i.id, line.invoiceId), eq(i.studentId, studentId)) });
      if (!invoice) continue;
      const allocations = await tx.query.paymentAllocations.findMany({ where: (a, { eq }) => eq(a.invoiceLineId, line.id) });
      if (allocations.reduce((sum, a) => sum + a.amountCents, 0) >= line.amountCents) return true;
    }
    return false;
  });
}

/**
 * Undo, through the owner's public reversal API, every payment that covers these lines and has not
 * been reversed yet (a failed earlier attempt, or the journey's own payment). Needs an owner page.
 * Returns the number of payments reversed.
 */
export async function reversePaymentsFor(ownerPage: Page, studentId: string, lineIds: string[], reason: string): Promise<number> {
  const result = await ownerPage.evaluate(
    async ({ studentId, lineIds, reason }) => {
      const res = await fetch(`/api/v1/admin/students/${studentId}/fees`);
      if (!res.ok) return -res.status;
      const fees = (await res.json()) as { payments: { id: string; reversesPaymentId: string | null; reversedByPaymentId: string | null; lines: { lineId: string }[] }[] };
      let reversed = 0;
      for (const payment of fees.payments) {
        if (payment.reversesPaymentId || payment.reversedByPaymentId || !payment.lines.some((l) => lineIds.includes(l.lineId))) continue;
        const r = await fetch(`/api/v1/admin/payments/${payment.id}/reverse`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ reason }) });
        if (!r.ok) return -r.status;
        reversed++;
      }
      return reversed;
    },
    { studentId, lineIds, reason },
  );
  if (result < 0) throw new Error(`Reversing journey payments failed with HTTP ${-result}`);
  return result;
}

/** A JSON request from inside the page, so the session cookie and CSRF protections apply as for the app. */
export async function pageApi<T = unknown>(page: Page, method: string, path: string, body?: unknown): Promise<{ status: number; body: T }> {
  return page.evaluate(
    async ({ method, path, body }) => {
      const res = await fetch(path, { method, headers: body === undefined ? {} : { 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      const text = await res.text();
      let parsed: unknown = text;
      try { parsed = JSON.parse(text); } catch { /* not JSON */ }
      return { status: res.status, body: parsed };
    },
    { method, path, body },
  ) as Promise<{ status: number; body: T }>;
}
