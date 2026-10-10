import { describe, expect, it, vi } from 'vitest';

vi.mock('@remix/db', async (importOriginal) => {
  const original = await importOriginal<typeof import('@remix/db')>();
  // The only withTenant call under test is the stale-pending lookup; hand back the fixed rows.
  return { ...original, withTenant: vi.fn(() => Promise.resolve([{ messageId: 'queued-ok' }, { messageId: 'lost' }])) };
});

import type { Db } from '@remix/db';
import type { Clock } from '../../common/time/clock';
import type { JobProducer } from '../../jobs/job-producer';
import { smsJobId } from '../../jobs/queues';
import type { AuditService } from '../audit/audit.service';
import { SmsWalletService } from './sms-wallet.service';

const TENANT = '00000000-0000-4000-8000-000000000001';

function setup(hasJob: (queue: string, jobId: string) => Promise<boolean>) {
  const jobs = { add: vi.fn(), hasJob: vi.fn(hasJob) } as unknown as JobProducer;
  const clock: Clock = { now: () => new Date('2026-10-10T10:00:00Z') };
  const wallet = new SmsWalletService({} as Db, clock, jobs, {} as AuditService);
  const refund = vi.spyOn(wallet, 'refund').mockResolvedValue(true);
  const markQueued = vi.spyOn(wallet, 'markQueued').mockResolvedValue(undefined);
  return { wallet, jobs, refund, markQueued };
}

describe('SmsWalletService.refundStalePending (enqueue-before-markQueued race)', () => {
  it('marks a message queued, not refunded, when its job exists; refunds one with no job', async () => {
    const { wallet, jobs, refund, markQueued } = setup((_queue, jobId) =>
      Promise.resolve(jobId === smsJobId(TENANT, 'queued-ok')),
    );
    await expect(wallet.refundStalePending(TENANT)).resolves.toBe(1);
    // eslint-disable-next-line @typescript-eslint/unbound-method -- a vi.fn mock, no `this`
    expect(jobs.hasJob).toHaveBeenCalledWith('sms', `sms-${TENANT}-queued-ok`);
    expect(markQueued).toHaveBeenCalledWith(TENANT, ['queued-ok']);
    expect(refund).toHaveBeenCalledTimes(1);
    expect(refund).toHaveBeenCalledWith(TENANT, 'lost');
  });

  it('refunds every stale message when no job exists, and marks nothing queued', async () => {
    const { wallet, refund, markQueued } = setup(() => Promise.resolve(false));
    await expect(wallet.refundStalePending(TENANT)).resolves.toBe(2);
    expect(refund).toHaveBeenCalledTimes(2);
    expect(markQueued).toHaveBeenCalledWith(TENANT, []);
  });

  it('leaves a message alone (no refund) when the queue cannot be asked', async () => {
    const { wallet, refund } = setup(() => Promise.reject(new Error('Job queue unavailable')));
    await expect(wallet.refundStalePending(TENANT)).resolves.toBe(0);
    expect(refund).not.toHaveBeenCalled();
  });
});
