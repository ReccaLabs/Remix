import { UnrecoverableError } from 'bullmq';
import { describe, expect, it, vi } from 'vitest';
import { SmsRejectedError, SmsTransportError } from '../../integrations/sms/sms-errors';
import type { SmsProvider } from '../../integrations/sms/sms.provider';
import { smsPayload } from '../queues';
import { createSmsProcessor, type SmsBilling } from './sms.processor';

const T = '0190aaaa-0000-7000-8000-000000000001';
const payload = (over: Record<string, unknown> = {}) =>
  smsPayload.parse({ tenantId: T, messageId: 'm1', gateway: 'remix-wallet', senderId: 'ReMix', to: '+94771234567', text: 'hi', ...over });
const ctx = (attempt: number) => ({ queue: 'sms' as const, jobId: 'j', attempt });
const billing = (): SmsBilling & { onSent: ReturnType<typeof vi.fn>; onPermanentFailure: ReturnType<typeof vi.fn> } => ({
  onSent: vi.fn(() => Promise.resolve()),
  onPermanentFailure: vi.fn(() => Promise.resolve()),
});
const failing = (error: Error): SmsProvider => ({ send: () => Promise.reject(error) });
const ok: SmsProvider = { send: () => Promise.resolve({ providerMessageId: 'x', segments: 1 }) };

describe('sms processor with wallet billing (MSG-02)', () => {
  it('keeps the payload strict and billed optional', () => {
    expect(() => smsPayload.parse({ ...payload(), billed: false })).toThrow();
    expect(() => smsPayload.parse({ ...payload(), extra: 1 })).toThrow();
    expect(payload({ billed: true }).billed).toBe(true);
  });

  it('marks a billed message sent, and ignores billing for OTP messages', async () => {
    const b = billing();
    await createSmsProcessor(ok, b)(payload({ billed: true }), ctx(1));
    expect(b.onSent).toHaveBeenCalledWith(T, 'm1');
    const otp = billing();
    await createSmsProcessor(ok, otp)(payload(), ctx(1));
    expect(otp.onSent).not.toHaveBeenCalled();
  });

  it('refunds at once on a rejected number and stops retrying', async () => {
    const b = billing();
    const run = createSmsProcessor(failing(new SmsRejectedError('notify.lk', 'invalid number')), b);
    await expect(run(payload({ billed: true }), ctx(1))).rejects.toBeInstanceOf(UnrecoverableError);
    expect(b.onPermanentFailure).toHaveBeenCalledWith(T, 'm1');
  });

  it('refunds a transient failure only on the last attempt', async () => {
    const b = billing();
    const run = createSmsProcessor(failing(new SmsTransportError('notify.lk', 'HTTP 503')), b);
    for (const attempt of [1, 2, 3, 4]) await expect(run(payload({ billed: true }), ctx(attempt))).rejects.toBeInstanceOf(SmsTransportError);
    expect(b.onPermanentFailure).not.toHaveBeenCalled();
    await expect(run(payload({ billed: true }), ctx(5))).rejects.toBeInstanceOf(SmsTransportError);
    expect(b.onPermanentFailure).toHaveBeenCalledTimes(1);
  });

  it('never refunds an unbilled (OTP) message', async () => {
    const b = billing();
    await expect(createSmsProcessor(failing(new SmsRejectedError('x', 'bad')), b)(payload(), ctx(1))).rejects.toBeInstanceOf(UnrecoverableError);
    expect(b.onPermanentFailure).not.toHaveBeenCalled();
  });

  it('a bookkeeping failure after a successful send does not fail (and re-send) the job', async () => {
    const b = billing();
    b.onSent.mockRejectedValue(new Error('db down'));
    await expect(createSmsProcessor(ok, b)(payload({ billed: true }), ctx(1))).resolves.toBeUndefined();
  });
});
