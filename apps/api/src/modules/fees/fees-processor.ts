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
  // FEE-12: parents get reminder texts at 09:00, not in the middle of the night.
  reminders: { pattern: '0 9 * * *', tz: 'Asia/Colombo' },
} as const;

/** What the fees worker needs from the SMS module (FEE-12). */
export interface ReminderRunner {
  runAutomatic(tenantId: string, date: string): Promise<unknown>;
}

/** Ticks fan out ids only; every actual invoice/projection job enters withTenant as remix_app. */
export function createFeesProcessor(db: Db, jobs: JobProducer, clock: Clock,
  alert: (tenantId: string, invoiceIds: string[]) => void, reminders?: ReminderRunner): JobProcessor<'fees'> {
  return async payload => {
    const now = clock.now();
    if (payload.kind === 'monthly_tick' || payload.kind === 'nightly_tick' || payload.kind === 'reminders_tick') {
      const tenants = (await db.execute<{ id: string }>(sql`select id from public.invoice_job_tenants()`)).rows;
      const today = calendarDate(now);
      for (const tenant of tenants) await jobs.add('fees', payload.kind === 'monthly_tick'
        ? { kind: 'invoices', tenantId: tenant.id, month: today.slice(0, 7) }
        : payload.kind === 'reminders_tick'
          ? { kind: 'reminders', tenantId: tenant.id, date: today }
          : { kind: 'recompute', tenantId: tenant.id, date: today });
      return;
    }
    if (payload.kind === 'reminders') {
      await reminders?.runAutomatic(payload.tenantId, payload.date);
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
