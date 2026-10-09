import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, asc, desc, eq, inArray, ne, sql, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { schema, withTenant, type Db, type Tx } from '@remix/db';
import { can } from '@remix/types';
import type {
  API,
  InvoiceLine,
  MyFeesResponse,
  SignedUrl,
  Slip,
  SlipStatus,
  SlipUploadResponse,
  SubmitSlipRequest,
} from '@remix/types/api';
import type { z } from 'zod';
import type { AuthSession } from '../../common/auth/session-authenticator';
import { AppException } from '../../common/errors/app-exception';
import { calendarDate } from '../../common/time/business-date';
import { CLOCK, type Clock } from '../../common/time/clock';
import { STORAGE_PROVIDER, type StorageProvider } from '../../integrations/storage/storage.provider';
import { JOB_PRODUCER, type JobProducer } from '../../jobs/job-producer';
import { AuditService } from '../audit/audit.service';
import { DB } from '../db/db.module';
import { FeesHooks } from '../fees/fees-hooks';
import { lockLedger, recordPayment } from '../fees/ledger';
import { safeCents } from '../fees/projections';
import { relativeKey, SLIP_EXTENSIONS, slipKeyPrefix } from './slip-keys';

const { bankSlips, bankSlipLines, uploads, invoiceLines, invoices, classes, students, tenantUsers, tenantSettings } = schema;
const reviewer = alias(tenantUsers, 'reviewer');
const duplicateStudent = alias(tenantUsers, 'duplicate_student');
type ListQuery = z.output<typeof API.listSlips.query>;

/** Presigned PUT lifetime (ADR 0009: ≤ 10 min). */
export const UPLOAD_URL_TTL_SEC = 600;
/** A slip image link for the cashier's viewer. */
export const IMAGE_URL_TTL_SEC = 300;
/** An upload must be submitted within this long, well before the 24 h clean-up can touch it. */
export const SUBMIT_WINDOW_MS = 60 * 60 * 1000;
/** Slips older than this are not accepted (and none dated in the future). */
const MAX_SLIP_AGE_DAYS = 400;
/** Statuses that still wait for the cashier ("Checking" for the student). */
const WAITING: SlipStatus[] = ['processing', 'submitted'];

const slipNotFound = () => new AppException('NOT_FOUND', 404, 'Slip not found');
const uploadNotFound = () => new AppException('NOT_FOUND', 404, 'Upload not found or expired. Choose the photo again');
const conflict = (title: string) => new AppException('CONFLICT', 409, title);

/** Rule 4: upper-case, no whitespace. */
export function normaliseReference(reference: string): string {
  return reference.replace(/\s/g, '').toUpperCase();
}

/** Today in Colombo minus `days`, as `YYYY-MM-DD`. */
function daysBefore(now: Date, days: number): string {
  return calendarDate(new Date(now.getTime() - days * 86_400_000));
}

/**
 * FEE-05 (student upload and submit) and FEE-06 (cashier queue, approve, reject) per ADR 0008 §5
 * and ADR 0009. Every query runs in `withTenant` as `remix_app`, so RLS confines it to the
 * caller's tenant before any ownership check below.
 */
@Injectable()
export class SlipsService {
  private readonly logger = new Logger('Slips');

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
    @Inject(JOB_PRODUCER) private readonly jobs: JobProducer,
    private readonly audit: AuditService,
    private readonly hooks: FeesHooks,
  ) {}

  // ----- Student (FEE-05) ---------------------------------------------------------------------

  async requestUpload(
    tenantId: string,
    session: AuthSession,
    body: z.output<typeof API.requestSlipUpload.request>,
  ): Promise<SlipUploadResponse> {
    const studentId = studentOf(session, tenantId);
    const now = this.clock.now();
    const upload = await withTenant(this.db, tenantId, async (tx) => {
      const [settings] = await tx.select({ bankDetails: tenantSettings.bankDetails }).from(tenantSettings);
      if (!settings?.bankDetails) throw conflict('Bank slips are not accepted by this institute');
      const prefix = slipKeyPrefix(tenantId, now);
      const extension = `.${SLIP_EXTENSIONS[body.contentType]}`;
      // Explicit columns: INSERT is granted on these only (ids, status and times are defaults).
      // Server-generated key: <tenant>/slips/<yyyy>/<mm>/<uuidv7>.<ext> (ADR 0009).
      const inserted = await tx.execute<{ id: string }>(sql`
        insert into uploads (tenant_id, kind, created_by, content_type, size_bytes, object_key, created_at)
        values (${tenantId}, 'slip', ${studentId}, ${body.contentType}, ${body.sizeBytes},
          ${prefix} || uuidv7()::text || ${extension}, ${now.toISOString()})
        returning id`);
      const [row] = await tx.select().from(uploads).where(eq(uploads.id, inserted.rows[0]?.id ?? ''));
      if (!row) throw new Error('Upload not inserted');
      return row;
    });
    const signed = await this.storage.createUploadUrl({
      tenantId,
      key: relativeKey(tenantId, upload.objectKey),
      contentType: upload.contentType,
      sizeBytes: upload.sizeBytes,
      expiresInSec: UPLOAD_URL_TTL_SEC,
    });
    return { uploadId: upload.id, url: signed.url, headers: signed.headers, expiresAt: signed.expiresAt.toISOString() };
  }

  async submit(tenantId: string, session: AuthSession, body: SubmitSlipRequest): Promise<Slip> {
    const studentId = studentOf(session, tenantId);
    const now = this.clock.now();
    const today = calendarDate(now);
    if (body.slipDate > today || body.slipDate < daysBefore(now, MAX_SLIP_AGE_DAYS)) {
      throw new AppException('VALIDATION_FAILED', 400, 'Use the date printed on the slip', {
        errors: [{ path: 'slipDate', message: 'Must be a recent date, not in the future' }],
      });
    }
    const lineIds = [...new Set(body.lineIds)];
    if (lineIds.length !== body.lineIds.length) throw new AppException('VALIDATION_FAILED', 400, 'Choose each month once');
    const slipId = await withTenant(this.db, tenantId, async (tx) => {
      // Same lock as every payment path: no approval or payment can interleave with this.
      await lockLedger(tx);
      const [upload] = await tx.select().from(uploads).where(eq(uploads.id, body.uploadId)).for('update');
      const [used] = upload ? await tx.select({ id: bankSlips.id }).from(bankSlips).where(eq(bankSlips.uploadId, upload.id)) : [];
      if (
        !upload ||
        used ||
        upload.createdBy !== studentId ||
        upload.status !== 'pending' ||
        upload.createdAt.getTime() < now.getTime() - SUBMIT_WINDOW_MS
      ) {
        // One answer for foreign, expired, used and unknown uploads.
        throw uploadNotFound();
      }
      const open = await openLines(tx, lineIds);
      if (open.length !== lineIds.length || open.some((l) => l.studentId !== studentId || l.voided)) {
        throw new AppException('NOT_FOUND', 404, 'Fee month not found');
      }
      if (open.some((l) => l.openCents <= 0)) throw new AppException('ALREADY_PAID', 409, 'A selected month is already paid');

      // ADR 0008 §5: a new slip for the same months supersedes one still waiting. A waiting slip
      // that also covers other months is not silently dropped: the student is told instead.
      const waiting = await tx
        .select({ slipId: bankSlipLines.slipId, lineId: bankSlipLines.invoiceLineId })
        .from(bankSlipLines)
        .innerJoin(bankSlips, and(eq(bankSlips.tenantId, bankSlipLines.tenantId), eq(bankSlips.id, bankSlipLines.slipId)))
        .where(
          and(
            eq(bankSlips.studentId, studentId),
            inArray(bankSlips.status, WAITING),
            sql`${bankSlips.id} in (select l.slip_id from public.bank_slip_lines l where l.tenant_id = ${bankSlips.tenantId} and l.invoice_line_id in (${sql.join(lineIds.map((id) => sql`${id}::uuid`), sql`, `)}))`,
          ),
        )
        .for('update', { of: bankSlips });
      const bySlip = new Map<string, string[]>();
      for (const w of waiting) bySlip.set(w.slipId, [...(bySlip.get(w.slipId) ?? []), w.lineId]);
      if ([...bySlip.values()].some((lines) => lines.some((id) => !lineIds.includes(id)))) {
        throw conflict('A slip for some of these months is still being checked. Include all of its months or wait');
      }
      if (bySlip.size) {
        await tx
          .update(bankSlips)
          .set({ status: 'superseded', reviewedAt: now })
          .where(inArray(bankSlips.id, [...bySlip.keys()]));
      }
      const inserted = await tx.execute<{ id: string }>(sql`
        insert into bank_slips (tenant_id, student_id, upload_id, amount_cents, reference, reference_norm, slip_date, submitted_at)
        values (${tenantId}, ${studentId}, ${upload.id}, ${body.amountCents}, ${body.reference},
          ${normaliseReference(body.reference)}, ${body.slipDate}, ${now.toISOString()})
        returning id`);
      const slip = inserted.rows[0];
      if (!slip) throw new Error('Slip not inserted');
      await tx.execute(sql`insert into bank_slip_lines (tenant_id, slip_id, invoice_line_id)
        select ${tenantId}::uuid, ${slip.id}::uuid, line::uuid from unnest(${sql.param(lineIds)}::text[]) as line`);
      return slip.id;
    });
    // After commit (ids only). If this enqueue is lost, the hourly clean-up re-adds it.
    try {
      await this.jobs.add('media', { kind: 'slip', tenantId, uploadId: body.uploadId });
    } catch (error) {
      this.logger.error({ tenantId, slipId, err: error instanceof Error ? error.name : 'unknown' }, 'Slip image job enqueue failed');
    }
    const [slip] = await withTenant(this.db, tenantId, (tx) => this.slipRows(tx, { where: eq(bankSlips.id, slipId), withDuplicates: false }));
    if (!slip) throw slipNotFound();
    return slip;
  }

  // ----- Cashier (FEE-06) ---------------------------------------------------------------------

  list(tenantId: string, query: ListQuery) {
    return withTenant(this.db, tenantId, async (tx) => {
      const where = eq(bankSlips.status, query.status);
      const [count] = await tx.select({ n: sql<string>`count(*)` }).from(bankSlips).where(where);
      const items = await this.slipRows(tx, {
        where,
        limit: query.pageSize,
        offset: (query.page - 1) * query.pageSize,
        withDuplicates: true,
      });
      return { page: query.page, pageSize: query.pageSize, total: Number(count?.n ?? 0), items };
    });
  }

  async get(tenantId: string, id: string): Promise<Slip> {
    const [slip] = await withTenant(this.db, tenantId, (tx) => this.slipRows(tx, { where: eq(bankSlips.id, id), withDuplicates: true }));
    if (!slip) throw slipNotFound();
    return slip;
  }

  /** Signed GET of the processed image, issued only after the permission guard and RLS lookup. */
  async image(tenantId: string, session: AuthSession, id: string): Promise<SignedUrl> {
    if (session.kind !== 'staff' || !can(session.roles, 'fees.read')) throw new AppException('FORBIDDEN', 403);
    const row = await withTenant(this.db, tenantId, async (tx) => {
      const [found] = await tx
        .select({ status: uploads.status, processedKey: uploads.processedKey })
        .from(bankSlips)
        .innerJoin(uploads, and(eq(uploads.tenantId, bankSlips.tenantId), eq(uploads.id, bankSlips.uploadId)))
        .where(eq(bankSlips.id, id));
      return found;
    });
    if (!row) throw slipNotFound();
    if (row.status === 'pending') throw conflict('The slip photo is still being prepared. Try again shortly');
    if (!row.processedKey) throw new AppException('NOT_FOUND', 404, 'This slip has no readable photo');
    const signed = await this.storage.createDownloadUrl({
      tenantId,
      key: relativeKey(tenantId, row.processedKey),
      expiresInSec: IMAGE_URL_TTL_SEC,
      downloadName: `slip-${id}.jpg`,
      disposition: 'inline',
    });
    // The URL is returned to the caller only: never stored, never logged.
    return { url: signed.url, expiresAt: signed.expiresAt.toISOString() };
  }

  /**
   * ADR 0008 §5: a `slip` payment for the expected open amount of the slip's months, through the
   * ledger. The tenant ledger lock and the slip row lock serialise approvals; the idempotency key
   * `slip:<id>` makes a double click or a concurrent approve return the same single payment.
   */
  async approve(tenantId: string, session: AuthSession, id: string, confirmDuplicate: boolean): Promise<Slip> {
    const actorId = staffOf(session, tenantId, 'fees.collect');
    const now = this.clock.now();
    const recorded = await withTenant(this.db, tenantId, async (tx) => {
      await lockLedger(tx);
      const [slip] = await tx.select().from(bankSlips).where(eq(bankSlips.id, id)).for('update');
      if (!slip) throw slipNotFound();
      if (slip.status === 'approved') return null;
      if (slip.status !== 'submitted') throw conflict('This slip is no longer waiting for review');
      const duplicate = await findDuplicate(tx, slip);
      if (duplicate && !confirmDuplicate) throw conflict('Reference used before. Confirm to approve anyway');
      const lineIds = (await tx.select({ id: bankSlipLines.invoiceLineId }).from(bankSlipLines).where(eq(bankSlipLines.slipId, id))).map((l) => l.id);
      const open = await openLines(tx, lineIds);
      if (open.some((l) => l.voided)) throw conflict('A month of this slip was cancelled. Reject the slip');
      if (open.some((l) => l.openCents <= 0)) throw new AppException('ALREADY_PAID', 409, 'A month of this slip is already paid');
      const expected = safeCents(open.reduce((n, l) => n + l.openCents, 0));
      const payment = await recordPayment(
        tx,
        {
          method: 'slip',
          amountCents: expected,
          lines: lineIds,
          idempotencyKey: `slip:${id}`,
          receivedBy: actorId,
          studentId: slip.studentId,
          providerRef: slip.reference,
          slipId: id,
        },
        now,
        this.audit,
      );
      await tx
        .update(bankSlips)
        .set({
          status: 'approved',
          paymentId: payment.payment.id,
          reviewedBy: actorId,
          reviewedAt: now,
          duplicateConfirmed: Boolean(duplicate),
        })
        .where(eq(bankSlips.id, id));
      await this.audit.record(tx, tenantId, {
        action: 'slip.approve',
        actorId,
        actorKind: 'staff',
        at: now,
        entity: 'bank_slip',
        entityId: id,
        after: {
          paymentId: payment.payment.id,
          expectedCents: expected,
          writtenCents: slip.amountCents,
          lines: lineIds.length,
          ...(duplicate ? { duplicateOf: duplicate.slipId, confirmDuplicate: true } : {}),
        },
      });
      return payment;
    });
    if (recorded?.receiptId && !recorded.replayed) {
      await this.hooks.onPaymentCommitted({
        tenantId,
        paymentId: recorded.payment.id,
        receiptId: recorded.receiptId,
        jobKey: `receipt:${tenantId}:${recorded.payment.id}`,
      });
    }
    // TODO(3-F): SMS the student that the slip was approved (MSG-04 template), after commit.
    return this.get(tenantId, id);
  }

  async reject(tenantId: string, session: AuthSession, id: string, reason: string): Promise<Slip> {
    const actorId = staffOf(session, tenantId, 'fees.collect');
    const now = this.clock.now();
    await withTenant(this.db, tenantId, async (tx) => {
      await lockLedger(tx);
      const [slip] = await tx.select().from(bankSlips).where(eq(bankSlips.id, id)).for('update');
      if (!slip) throw slipNotFound();
      // A repeated click with the same reason is a no-op; anything else is a conflict.
      if (slip.status === 'rejected' && slip.rejectReason === reason && slip.reviewedBy === actorId) return;
      if (slip.status !== 'submitted') throw conflict('This slip is no longer waiting for review');
      await tx
        .update(bankSlips)
        .set({ status: 'rejected', rejectReason: reason, reviewedBy: actorId, reviewedAt: now })
        .where(eq(bankSlips.id, id));
      await this.audit.record(tx, tenantId, {
        action: 'slip.reject',
        actorId,
        actorKind: 'staff',
        at: now,
        entity: 'bank_slip',
        entityId: id,
        after: { reason },
      });
    });
    // TODO(3-F): SMS the student the rejection reason (ADR 0008 §5, MSG-04 template), after commit.
    return this.get(tenantId, id);
  }

  // ----- Read model -----------------------------------------------------------------------------

  private async slipRows(
    tx: Tx,
    opts: { where: SQL; limit?: number; offset?: number; withDuplicates: boolean },
  ): Promise<Slip[]> {
    const rows = await tx
      .select({
        slip: bankSlips,
        studentNo: students.studentNo,
        studentName: tenantUsers.displayName,
        reviewedByName: reviewer.displayName,
      })
      .from(bankSlips)
      .innerJoin(students, and(eq(students.tenantId, bankSlips.tenantId), eq(students.userId, bankSlips.studentId)))
      .innerJoin(tenantUsers, and(eq(tenantUsers.tenantId, bankSlips.tenantId), eq(tenantUsers.id, bankSlips.studentId)))
      .leftJoin(reviewer, and(eq(reviewer.tenantId, bankSlips.tenantId), eq(reviewer.id, bankSlips.reviewedBy)))
      .where(opts.where)
      // FEE-06: the queue is oldest first.
      .orderBy(asc(bankSlips.submittedAt), asc(bankSlips.id))
      .limit(opts.limit ?? 1000)
      .offset(opts.offset ?? 0);
    if (!rows.length) return [];
    const ids = rows.map((r) => r.slip.id);
    const links = await tx
      .select({ slipId: bankSlipLines.slipId, lineId: bankSlipLines.invoiceLineId })
      .from(bankSlipLines)
      .where(inArray(bankSlipLines.slipId, ids));
    const lines = await lineViews(
      tx,
      [...new Set(links.map((l) => l.lineId))],
      calendarDate(this.clock.now()),
    );
    const byId = new Map(lines.map((l) => [l.id, l]));
    const duplicates = opts.withDuplicates ? await duplicatesFor(tx, rows.map((r) => r.slip)) : new Map<string, Slip['duplicateOf']>();
    return rows.map(({ slip, ...r }) => {
      const slipLines = links
        .filter((l) => l.slipId === slip.id)
        .map((l) => byId.get(l.lineId))
        .filter((l): l is InvoiceLine => Boolean(l))
        .sort((a, b) => a.month.localeCompare(b.month) || a.id.localeCompare(b.id));
      return {
        id: slip.id,
        status: slip.status,
        studentId: slip.studentId,
        studentNo: r.studentNo,
        studentName: r.studentName,
        submittedAt: slip.submittedAt.toISOString(),
        amountCents: slip.amountCents,
        expectedCents: safeCents(slipLines.reduce((n, l) => n + l.openCents, 0)),
        reference: slip.reference,
        slipDate: slip.slipDate,
        lines: slipLines,
        duplicateOf: duplicates.get(slip.id) ?? null,
        rejectReason: slip.rejectReason,
        reviewedByName: r.reviewedByName,
        reviewedAt: slip.reviewedAt?.toISOString() ?? null,
      };
    });
  }
}

/** The student's own slips for `myFees` (newest first). */
export async function mySlips(tx: Tx, studentId: string): Promise<MyFeesResponse['slips']> {
  const rows = await tx
    .select()
    .from(bankSlips)
    .where(eq(bankSlips.studentId, studentId))
    .orderBy(desc(bankSlips.submittedAt), desc(bankSlips.id))
    .limit(20);
  return rows.map((s) => ({
    id: s.id,
    status: s.status,
    submittedAt: s.submittedAt.toISOString(),
    amountCents: s.amountCents,
    reference: s.reference,
    rejectReason: s.rejectReason,
  }));
}

function studentOf(session: AuthSession, tenantId: string): string {
  if (session.kind !== 'student' || session.tenantId !== tenantId) throw new AppException('FORBIDDEN', 403);
  return session.userId;
}

/** Defence in depth: the guard already required the permission. */
function staffOf(session: AuthSession, tenantId: string, permission: 'fees.collect'): string {
  if (session.kind !== 'staff' || session.tenantId !== tenantId || !can(session.roles, permission)) {
    throw new AppException('FORBIDDEN', 403);
  }
  return session.userId;
}

interface OpenLine {
  id: string;
  studentId: string;
  voided: boolean;
  openCents: number;
}

/** Selected lines with their owner and open balance, locked like every ledger path. */
async function openLines(tx: Tx, lineIds: readonly string[]): Promise<OpenLine[]> {
  if (!lineIds.length) return [];
  const rows = await tx
    .select({
      id: invoiceLines.id,
      studentId: invoices.studentId,
      voidedAt: invoiceLines.voidedAt,
      amountCents: invoiceLines.amountCents,
    })
    .from(invoiceLines)
    .innerJoin(invoices, and(eq(invoices.tenantId, invoiceLines.tenantId), eq(invoices.id, invoiceLines.invoiceId)))
    .where(inArray(invoiceLines.id, [...lineIds]))
    .orderBy(asc(invoiceLines.month), asc(invoiceLines.id))
    .for('update', { of: invoiceLines });
  const sums = await tx
    .select({ id: schema.paymentAllocations.invoiceLineId, paid: sql<string>`sum(${schema.paymentAllocations.amountCents})` })
    .from(schema.paymentAllocations)
    .where(inArray(schema.paymentAllocations.invoiceLineId, [...lineIds]))
    .groupBy(schema.paymentAllocations.invoiceLineId);
  const paid = new Map(sums.map((s) => [s.id, safeCents(s.paid)]));
  return rows.map((r) => ({
    id: r.id,
    studentId: r.studentId,
    voided: r.voidedAt !== null,
    openCents: r.voidedAt ? 0 : Math.max(0, r.amountCents - (paid.get(r.id) ?? 0)),
  }));
}

/** `invoiceLineSchema` views of the given lines (any state: the queue also shows paid months). */
export async function lineViews(tx: Tx, lineIds: readonly string[], today: string): Promise<InvoiceLine[]> {
  if (!lineIds.length) return [];
  const rows = await tx
    .select({
      line: invoiceLines,
      number: invoices.number,
      dueOn: invoices.dueOn,
      className: classes.name,
      paid: sql<string>`coalesce((select sum(a.amount_cents) from public.payment_allocations a where a.tenant_id = ${invoiceLines.tenantId} and a.invoice_line_id = ${invoiceLines.id}), 0)`,
      slipWaiting: slipWaitingSql(),
    })
    .from(invoiceLines)
    .innerJoin(invoices, and(eq(invoices.tenantId, invoiceLines.tenantId), eq(invoices.id, invoiceLines.invoiceId)))
    .innerJoin(classes, and(eq(classes.tenantId, invoiceLines.tenantId), eq(classes.id, invoiceLines.classId)))
    .where(inArray(invoiceLines.id, [...lineIds]));
  return rows.map((r) => {
    const paidCents = Math.max(0, safeCents(r.paid));
    const voided = r.line.voidedAt !== null;
    const openCents = voided ? 0 : Math.max(0, r.line.amountCents - paidCents);
    return {
      id: r.line.id,
      invoiceId: r.line.invoiceId,
      invoiceNumber: r.number,
      enrollmentId: r.line.enrollmentId,
      classId: r.line.classId,
      className: r.className,
      month: r.line.month,
      dueOn: r.dueOn,
      amountCents: r.line.amountCents,
      paidCents: Math.min(paidCents, r.line.amountCents),
      openCents,
      paid: !voided && openCents === 0,
      overdue: openCents > 0 && today > r.dueOn,
      slipWaiting: r.slipWaiting,
    };
  });
}

/** True when a slip waiting for review (`processing`/`submitted`) covers the line. */
export function slipWaitingSql(): SQL<boolean> {
  return sql<boolean>`exists (select 1 from public.bank_slip_lines bl join public.bank_slips bs
    on bs.tenant_id = bl.tenant_id and bs.id = bl.slip_id
    where bl.tenant_id = ${invoiceLines.tenantId} and bl.invoice_line_id = ${invoiceLines.id}
      and bs.status in ('processing', 'submitted'))`;
}

/** Rule 4: an approved slip in this tenant with the same normalised reference and amount. */
async function findDuplicate(tx: Tx, slip: typeof bankSlips.$inferSelect) {
  const [row] = await tx
    .select({ slipId: bankSlips.id })
    .from(bankSlips)
    .where(
      and(
        eq(bankSlips.referenceNorm, slip.referenceNorm),
        eq(bankSlips.amountCents, slip.amountCents),
        eq(bankSlips.status, 'approved'),
        ne(bankSlips.id, slip.id),
      ),
    )
    .orderBy(desc(bankSlips.reviewedAt))
    .limit(1);
  return row;
}

async function duplicatesFor(tx: Tx, slips: (typeof bankSlips.$inferSelect)[]): Promise<Map<string, Slip['duplicateOf']>> {
  const result = new Map<string, Slip['duplicateOf']>();
  const norms = [...new Set(slips.map((s) => s.referenceNorm))];
  if (!norms.length) return result;
  const approved = await tx
    .select({ slip: bankSlips, studentName: duplicateStudent.displayName })
    .from(bankSlips)
    .innerJoin(duplicateStudent, and(eq(duplicateStudent.tenantId, bankSlips.tenantId), eq(duplicateStudent.id, bankSlips.studentId)))
    .where(and(inArray(bankSlips.referenceNorm, norms), eq(bankSlips.status, 'approved')))
    .orderBy(desc(bankSlips.reviewedAt));
  for (const slip of slips) {
    const match = approved.find(
      (a) => a.slip.id !== slip.id && a.slip.referenceNorm === slip.referenceNorm && a.slip.amountCents === slip.amountCents,
    );
    if (match?.slip.reviewedAt) {
      result.set(slip.id, { slipId: match.slip.id, studentName: match.studentName, approvedAt: match.slip.reviewedAt.toISOString() });
    }
  }
  return result;
}
