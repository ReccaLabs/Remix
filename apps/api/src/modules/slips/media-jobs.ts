import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, eq, gte, lt, sql } from 'drizzle-orm';
import { schema, withTenant, type Db } from '@remix/db';
import { SLIP_MAX_BYTES } from '@remix/types/api';
import { CLOCK, type Clock } from '../../common/time/clock';
import {
  ObjectTooLargeError,
  STORAGE_PROVIDER,
  type StorageProvider,
} from '../../integrations/storage/storage.provider';
import type { JobProducer } from '../../jobs/job-producer';
import { FEES_SYSTEM_TENANT, type JobPayload } from '../../jobs/queues';
import { DB } from '../db/db.module';
import { reencodeSlipImage, UnreadableImageError } from './media';
import { relativeKey } from './slip-keys';

const { uploads, bankSlips } = schema;

/** Unprocessed uploads (and their objects) are deleted after this long (ADR 0009). */
export const UPLOAD_RETENTION_MS = 24 * 60 * 60 * 1000;
/** Slip rejection reason when the file cannot be decoded (ADR 0009). */
export const UNREADABLE_FILE = 'Unreadable file';
/** A slip still `processing` this long after submission has probably lost its job. */
const REQUEUE_AFTER_MS = 10 * 60 * 1000;
/** Upper bound per clean-up job; the next hourly run continues. */
const CLEANUP_BATCH = 200;

export const MEDIA_SCHEDULES = {
  cleanup: { pattern: '17 * * * *', tz: 'Asia/Colombo' },
} as const;

/** `YYYY-MM-DDTHH` of `now` in Colombo: one clean-up job per tenant per hour. */
export function colomboHour(now: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Colombo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}T${part('hour')}`;
}

/**
 * The `media` queue (ADR 0009). Every step is idempotent: the processed key is derived from the
 * upload id, state changes are guarded by `status = 'pending'`/`'processing'`, and deleting an
 * object that is already gone is a no-op, so a retried or duplicated job converges.
 */
@Injectable()
export class MediaJobRunner {
  private readonly logger = new Logger('MediaJobs');

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /**
   * `jobs` fans the hourly tick out (worker only). The runner does not inject the producer
   * itself: in development the inline producer runs this runner, which would be circular.
   */
  async run(payload: JobPayload<'media'>, jobs?: JobProducer): Promise<void> {
    if (payload.kind === 'slip') return this.processSlip(payload.tenantId, payload.uploadId);
    if (payload.kind === 'cleanup') {
      await this.cleanup(payload.tenantId, jobs);
      return;
    }
    if (!jobs) throw new Error('The clean-up tick needs a job producer');
    // Ticks touch no tenant rows: only the narrow tenant-id discovery function (ADR 0012).
    const tenants = (await this.db.execute<{ id: string }>(sql`select id from public.invoice_job_tenants()`)).rows;
    const hour = colomboHour(this.clock.now());
    for (const tenant of tenants) {
      if (tenant.id === FEES_SYSTEM_TENANT) continue;
      await jobs.add('media', { kind: 'cleanup', tenantId: tenant.id, hour });
    }
  }

  /** Re-encode the slip photo, then mark the upload processed and the slip `submitted`. */
  async processSlip(tenantId: string, uploadId: string): Promise<void> {
    const found = await withTenant(this.db, tenantId, async (tx) => {
      const [row] = await tx.select().from(uploads).where(eq(uploads.id, uploadId));
      return row;
    });
    if (!found) return;
    const original = relativeKey(tenantId, found.objectKey);
    if (found.status !== 'pending') {
      // A retry after commit: only the original may still need deleting.
      await this.storage.deleteObject({ tenantId, key: original });
      return;
    }
    const processedKey = processedKeyFor(original, uploadId);
    let jpeg: Buffer | null = null;
    try {
      const stored = await this.storage.getObject({ tenantId, key: original, maxBytes: SLIP_MAX_BYTES });
      if (!stored) throw new UnreadableImageError('the file was never uploaded');
      jpeg = await reencodeSlipImage(stored.body);
    } catch (error) {
      if (!(error instanceof UnreadableImageError || error instanceof ObjectTooLargeError)) throw error;
    }
    if (jpeg) {
      // Same key on every attempt: a retry overwrites, never duplicates.
      await this.storage.putObject({ tenantId, key: processedKey, body: jpeg, contentType: 'image/jpeg' });
    }
    const now = this.clock.now();
    await withTenant(this.db, tenantId, async (tx) => {
      const [locked] = await tx.select().from(uploads).where(eq(uploads.id, uploadId)).for('update');
      if (!locked || locked.status !== 'pending') return;
      await tx
        .update(uploads)
        .set(
          jpeg
            ? { status: 'processed', processedKey: `${tenantId}/${processedKey}`, processedAt: now }
            : { status: 'rejected', processedAt: now },
        )
        .where(eq(uploads.id, uploadId));
      // A slip superseded while it was processing keeps that state.
      await tx
        .update(bankSlips)
        .set(
          jpeg
            ? { status: 'submitted' }
            : { status: 'rejected', rejectReason: UNREADABLE_FILE, reviewedAt: now },
        )
        .where(and(eq(bankSlips.uploadId, uploadId), eq(bankSlips.status, 'processing')));
    });
    if (!jpeg) this.logger.warn({ tenantId, uploadId }, 'Slip upload rejected: unreadable file');
    await this.storage.deleteObject({ tenantId, key: original });
  }

  /**
   * Delete uploads still `pending` after 24 h. One that was never submitted loses its object and
   * row; one whose slip is stuck in `processing` (its job died) is rejected as unreadable, since
   * the slip row must keep pointing at it.
   */
  async cleanup(tenantId: string, jobs?: JobProducer): Promise<{ deleted: number; rejected: number; requeued: number }> {
    const cutoff = new Date(this.clock.now().getTime() - UPLOAD_RETENTION_MS);
    const requeued = jobs ? await this.requeueStuck(tenantId, cutoff, jobs) : 0;
    const stale = await withTenant(this.db, tenantId, (tx) =>
      tx
        .select({ id: uploads.id, objectKey: uploads.objectKey, slipId: bankSlips.id })
        .from(uploads)
        .leftJoin(bankSlips, and(eq(bankSlips.tenantId, uploads.tenantId), eq(bankSlips.uploadId, uploads.id)))
        .where(and(eq(uploads.status, 'pending'), lt(uploads.createdAt, cutoff)))
        .orderBy(uploads.createdAt)
        .limit(CLEANUP_BATCH),
    );
    let deleted = 0;
    let rejected = 0;
    for (const upload of stale) {
      const key = relativeKey(tenantId, upload.objectKey);
      if (upload.slipId) {
        const now = this.clock.now();
        const changed = await withTenant(this.db, tenantId, async (tx) => {
          const [locked] = await tx.select().from(uploads).where(eq(uploads.id, upload.id)).for('update');
          if (!locked || locked.status !== 'pending') return false;
          await tx.update(uploads).set({ status: 'rejected', processedAt: now }).where(eq(uploads.id, upload.id));
          await tx
            .update(bankSlips)
            .set({ status: 'rejected', rejectReason: UNREADABLE_FILE, reviewedAt: now })
            .where(and(eq(bankSlips.uploadId, upload.id), eq(bankSlips.status, 'processing')));
          return true;
        });
        await this.storage.deleteObject({ tenantId, key });
        if (changed) rejected += 1;
        continue;
      }
      // Object first: if the row delete fails, the next run retries both.
      await this.storage.deleteObject({ tenantId, key });
      const removed = await withTenant(this.db, tenantId, (tx) =>
        tx
          .delete(uploads)
          .where(
            and(
              eq(uploads.id, upload.id),
              eq(uploads.status, 'pending'),
              sql`not exists (select 1 from public.bank_slips s where s.tenant_id = ${uploads.tenantId} and s.upload_id = ${uploads.id})`,
            ),
          )
          .returning({ id: uploads.id }),
      );
      deleted += removed.length;
    }
    if (deleted || rejected) this.logger.log({ tenantId, deleted, rejected }, 'Stale uploads cleaned up');
    return { deleted, rejected, requeued };
  }

  /**
   * Repairs a lost enqueue after a submit (Valkey blip): a slip still `processing` after
   * {@link REQUEUE_AFTER_MS} gets its job added again. While the original job exists (running,
   * waiting or failed) the add is a no-op, so this never runs a slip twice at once.
   */
  private async requeueStuck(tenantId: string, cutoff: Date, jobs: JobProducer): Promise<number> {
    const before = new Date(this.clock.now().getTime() - REQUEUE_AFTER_MS);
    const stuck = await withTenant(this.db, tenantId, (tx) =>
      tx
        .select({ uploadId: uploads.id })
        .from(uploads)
        .innerJoin(bankSlips, and(eq(bankSlips.tenantId, uploads.tenantId), eq(bankSlips.uploadId, uploads.id)))
        .where(
          and(
            eq(uploads.status, 'pending'),
            eq(bankSlips.status, 'processing'),
            gte(uploads.createdAt, cutoff),
            lt(bankSlips.submittedAt, before),
          ),
        )
        .limit(CLEANUP_BATCH),
    );
    for (const row of stuck) await jobs.add('media', { kind: 'slip', tenantId, uploadId: row.uploadId });
    return stuck.length;
  }
}

/** `slips/2026/10/<random>.heic` → `slips/2026/10/<uploadId>.jpg`, same folder as the original. */
export function processedKeyFor(originalKey: string, uploadId: string): string {
  const folder = originalKey.slice(0, originalKey.lastIndexOf('/'));
  return `${folder}/${uploadId}.jpg`;
}
