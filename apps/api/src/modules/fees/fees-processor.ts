import { sql } from 'drizzle-orm';
import { withTenant, type Db } from '@remix/db';
import { calendarDate } from '../../common/time/business-date';
import type { Clock } from '../../common/time/clock';
import type { JobProducer } from '../../jobs/job-producer';
import type { JobProcessor } from '../../jobs/queues';
import { generateInvoices } from './invoice-generation';
import { lockLedger } from './ledger';
import { recomputeProjections } from './projections';

export const FEES_SCHEDULES = {
  monthly: { pattern: '5 0 1 * *', tz: 'Asia/Colombo' },
  nightly: { pattern: '20 0 * * *', tz: 'Asia/Colombo' },
} as const;

/** Ticks fan out ids only; every actual invoice/projection job enters withTenant as remix_app. */
export function createFeesProcessor(db: Db, jobs: JobProducer, clock: Clock,
  alert: (tenantId: string, invoiceIds: string[]) => void): JobProcessor<'fees'> {
  return async payload => {
    const now = clock.now();
    if (payload.kind === 'monthly_tick' || payload.kind === 'nightly_tick') {
      const tenants = (await db.execute<{ id: string }>(sql`select id from public.invoice_job_tenants()`)).rows;
      const today = calendarDate(now);
      for (const tenant of tenants) await jobs.add('fees', payload.kind === 'monthly_tick'
        ? { kind: 'invoices', tenantId: tenant.id, month: today.slice(0, 7) }
        : { kind: 'recompute', tenantId: tenant.id, date: today });
      return;
    }
    await withTenant(db, payload.tenantId, async tx => {
      if (payload.kind === 'invoices') { await generateInvoices(tx, payload.month, now); return; }
      await lockLedger(tx);
      const drift = await recomputeProjections(tx, now);
      if (drift.length) alert(payload.tenantId, drift);
    });
  };
}
