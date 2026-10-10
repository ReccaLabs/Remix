import { describe, expect, it, vi } from 'vitest';
import type { Db } from '@remix/db';
import { InsufficientSmsBalanceError, type SystemSmsService } from '../sms/system-sms.service';
import { SlipSmsNotifier, type SlipSmsTarget } from './slip-sms.notifier';

const TENANT = '00000000-0000-4000-8000-000000000001';
const SLIP = '00000000-0000-4000-8000-0000000000aa';
const PHONE = '+94771234567';

function setup(target: SlipSmsTarget | null, send = vi.fn().mockResolvedValue({ status: 'queued' })) {
  const notifier = new SlipSmsNotifier({} as Db, { send } as unknown as SystemSmsService);
  vi.spyOn(notifier, 'target').mockResolvedValue(target);
  return { notifier, send };
}

describe('SlipSmsNotifier (MSG-04, FEE-06)', () => {
  it('sends one approval SMS keyed by the slip', async () => {
    const { notifier, send } = setup({ phone: PHONE, months: 'Sep 2026, Oct 2026', receipt_no: 'R-0001' });
    await notifier.approved(TENANT, SLIP);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith(
      TENANT,
      'slip_approved',
      { months: 'Sep 2026, Oct 2026', receiptNo: 'R-0001' },
      PHONE,
      `slip-approved-${SLIP}`,
    );
  });

  it('sends the rejection reason keyed by the slip', async () => {
    const { notifier, send } = setup({ phone: PHONE, months: '', receipt_no: null });
    await notifier.rejected(TENANT, SLIP, 'Amount does not match');
    expect(send).toHaveBeenCalledWith(TENANT, 'slip_rejected', { reason: 'Amount does not match' }, PHONE, `slip-rejected-${SLIP}`);
  });

  it('skips when there is no mobile number', async () => {
    const { notifier, send } = setup({ phone: null, months: 'Oct 2026', receipt_no: null });
    await notifier.approved(TENANT, SLIP);
    expect(send).not.toHaveBeenCalled();
  });

  it('never throws: empty wallet, queue outage or unknown slip are swallowed', async () => {
    const empty = setup(
      { phone: PHONE, months: 'Oct 2026', receipt_no: 'R-1' },
      vi.fn().mockRejectedValue(new InsufficientSmsBalanceError(0, 100)),
    );
    await expect(empty.notifier.approved(TENANT, SLIP)).resolves.toBeUndefined();
    const down = setup(
      { phone: PHONE, months: 'Oct 2026', receipt_no: 'R-1' },
      vi.fn().mockRejectedValue(new Error('Job queue unavailable')),
    );
    await expect(down.notifier.rejected(TENANT, SLIP, 'Blurry photo')).resolves.toBeUndefined();
    const none = setup(null);
    await none.notifier.approved(TENANT, SLIP);
    expect(none.send).not.toHaveBeenCalled();
  });
});
