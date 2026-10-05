import { Inject, Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { schema, withTenant, type Db } from '@remix/db';
import { can } from '@remix/types';
import type { SignedUrl } from '@remix/types/api';
import type { AuthSession } from '../../common/auth/session-authenticator';
import { AppException } from '../../common/errors/app-exception';
import {
  STORAGE_PROVIDER,
  tenantObjectKey,
  type StorageProvider,
} from '../../integrations/storage/storage.provider';
import { JOB_PRODUCER, type JobProducer } from '../../jobs/job-producer';
import { DB } from '../db/db.module';
import { feeNotFound } from './ledger';

@Injectable()
export class ReceiptsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
    @Inject(JOB_PRODUCER) private readonly jobs: JobProducer,
  ) {}
  async pdf(tenantId: string, session: AuthSession, id: string): Promise<SignedUrl> {
    if (
      session.tenantId !== tenantId ||
      (session.kind !== 'student' && (session.kind !== 'staff' || !can(session.roles, 'fees.read')))
    )
      throw new AppException('FORBIDDEN', 403);
    const row = await withTenant(this.db, tenantId, async (tx) => {
      const [found] = await tx
        .select({ receipt: schema.receipts })
        .from(schema.receipts)
        .innerJoin(
          schema.payments,
          and(
            eq(schema.payments.tenantId, schema.receipts.tenantId),
            eq(schema.payments.id, schema.receipts.paymentId),
          ),
        )
        .where(
          and(
            eq(schema.receipts.id, id),
            session.kind === 'student' ? eq(schema.payments.studentId, session.userId) : undefined,
          ),
        );
      return found?.receipt;
    });
    if (!row) throw feeNotFound();
    if (!row.pdfKey) {
      // Also repairs a lost enqueue after commit and supports receipts predating this track.
      await this.jobs.add('receipts', { tenantId, paymentId: row.paymentId, receiptId: row.id });
      throw new AppException('CONFLICT', 409, 'Receipt PDF is being prepared. Try again shortly');
    }
    const prefix = `${tenantId}/`;
    if (!row.pdfKey.startsWith(prefix)) throw feeNotFound();
    const key = row.pdfKey.slice(prefix.length);
    if (tenantObjectKey(tenantId, key) !== row.pdfKey) throw feeNotFound();
    const signed = await this.storage.createDownloadUrl({
      tenantId,
      key,
      expiresInSec: 600,
      downloadName: `receipt-${row.id}.pdf`,
    });
    return { url: signed.url, expiresAt: signed.expiresAt.toISOString() };
  }
}
