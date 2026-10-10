import { describe, expect, it, vi } from 'vitest';
import type { Db } from '@remix/db';
import { ManualClock } from '../../common/time/clock';
import { FEES_SYSTEM_TENANT, feesBusinessKey, feesPayload } from '../../jobs/queues';
import type { JobProducer } from '../../jobs/job-producer';
import { createFeesProcessor, FEES_SCHEDULES } from './fees-processor';

const TENANT = '0190aaaa-0000-7000-8000-000000000002';
const fakeDb = { execute: () => Promise.resolve({ rows: [{ id: TENANT }] }) } as unknown as Db;

function setup(now: string) {
  const added: unknown[] = [];
  const jobs: JobProducer = { add: (queue, payload) => { added.push([queue, payload]); return Promise.resolve({ jobId: 'j' }); }, hasJob: () => Promise.resolve(false) };
  const reminders = { runAutomatic: vi.fn(() => Promise.resolve()) };
  const run = createFeesProcessor(fakeDb, jobs, new ManualClock(new Date(now)), () => undefined, reminders);
  return { added, reminders, run };
}
const ctx = { queue: 'fees' as const, jobId: 'j', attempt: 1 };

describe('FEE-12 reminder scheduling', () => {
  it('runs at 09:00 Asia/Colombo, separately from the 00:20 nightly recompute', () => {
    expect(FEES_SCHEDULES.reminders).toEqual({ pattern: '0 9 * * *', tz: 'Asia/Colombo' });
    expect(FEES_SCHEDULES.nightly.pattern).toBe('20 0 * * *');
  });

  it('fans out one reminders job per tenant with the Colombo calendar date', async () => {
    // 03:40 UTC on 5 Oct = 09:10 in Colombo, still 5 Oct. 18:40 UTC on 4 Oct is already 5 Oct there.
    for (const [now, date] of [['2026-10-05T03:40:00Z', '2026-10-05'], ['2026-10-04T18:40:00Z', '2026-10-05'], ['2026-10-04T18:20:00Z', '2026-10-04']] as const) {
      const { added, run } = setup(now);
      await run({ kind: 'reminders_tick', tenantId: FEES_SYSTEM_TENANT }, ctx);
      expect(added).toEqual([['fees', { kind: 'reminders', tenantId: TENANT, date }]]);
    }
  });

  it('the per-tenant job calls the runner with its tenant and date', async () => {
    const { reminders, run } = setup('2026-10-05T03:40:00Z');
    await run({ kind: 'reminders', tenantId: TENANT, date: '2026-10-05' }, ctx);
    expect(reminders.runAutomatic).toHaveBeenCalledWith(TENANT, '2026-10-05');
  });

  it('has a per-tenant per-day business key and a strict payload', () => {
    expect(feesBusinessKey({ kind: 'reminders', tenantId: TENANT, date: '2026-10-05' })).toBe(`fee-reminders:${TENANT}:2026-10-05`);
    expect(() => feesPayload.parse({ kind: 'reminders', tenantId: FEES_SYSTEM_TENANT, date: '2026-10-05' })).toThrow();
    expect(() => feesPayload.parse({ kind: 'reminders', tenantId: TENANT, date: 'tomorrow' })).toThrow();
  });
});
