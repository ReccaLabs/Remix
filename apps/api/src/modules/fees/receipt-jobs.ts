import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { schema, withTenant, type Db } from '@remix/db';
import {
  STORAGE_PROVIDER,
  tenantObjectKey,
  type StorageProvider,
} from '../../integrations/storage/storage.provider';
import { JOB_PRODUCER, type JobProducer } from '../../jobs/job-producer';
import type { JobPayload } from '../../jobs/queues';
import { DB } from '../db/db.module';
import { FeesHooks } from './fees-hooks';
import { feeNotFound } from './ledger';
import { receiptData } from './receipt-data';
import { renderReceiptPdf } from './receipt-pdf';

@Injectable()
export class ReceiptJobEnqueuer implements OnModuleInit {
  constructor(
    private readonly hooks: FeesHooks,
    @Inject(JOB_PRODUCER) private readonly jobs: JobProducer,
  ) {}
  onModuleInit(): void {
    this.hooks.registerPaymentCommitted(async (event) => {
      await this.jobs.add('receipts', {
        tenantId: event.tenantId,
        paymentId: event.paymentId,
        receiptId: event.receiptId,
      });
    });
  }
}

@Injectable()
export class ReceiptJobRunner {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
  ) {}
  async run(payload: JobPayload<'receipts'>): Promise<void> {
    await withTenant(this.db, payload.tenantId, async (tx) => {
      const [row] = await tx
        .select()
        .from(schema.receipts)
        .where(eq(schema.receipts.id, payload.receiptId))
        .for('update');
      if (!row || row.paymentId !== payload.paymentId) throw feeNotFound();
      if (row.pdfKey) return;
      const data = await receiptData(tx, payload.tenantId, row.id);
      const issued = row.issuedAt.toISOString();
      const key = `receipts/${issued.slice(0, 4)}/${issued.slice(5, 7)}/${row.id}.pdf`;
      // Lock stays held through put + commit. Crash after PUT retries the same key (one object).
      await this.storage.putObject({
        tenantId: payload.tenantId,
        key,
        body: renderReceiptPdf(data),
        contentType: 'application/pdf',
      });
      await tx
        .update(schema.receipts)
        .set({ pdfKey: tenantObjectKey(payload.tenantId, key) })
        .where(eq(schema.receipts.id, row.id));
    });
  }
}
