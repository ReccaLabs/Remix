import { describe, expect, it } from 'vitest';
import { can } from '../permissions';
import { ADDONS } from '../pricing';
import {
  cashPaymentSchema,
  idempotencyKeySchema,
  manualPaymentSchema,
  payhereNotifySchema,
  SLIP_MAX_BYTES,
  slipUploadRequestSchema,
  SMS_SEGMENT_PRICE_CENTS,
  smsSegments,
  submitSlipSchema,
  updateFeeSettingsSchema,
  updatePayhereSettingsSchema,
} from './fees';
import { API } from './routes';

const ID = '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b';
const ATTEMPT = 'cash-attempt-test-0001';

describe('money permissions (ADR 0008)', () => {
  it('lets only the owner reverse payments and change money settings', () => {
    for (const p of ['fees.reverse', 'fees.settings', 'sms.wallet'] as const) {
      expect(can(['owner'], p)).toBe(true);
      for (const role of ['admin', 'teacher', 'cashier', 'gatekeeper'] as const) {
        expect(can([role], p)).toBe(false);
      }
    }
  });

  it('lets cashiers collect but not reverse', () => {
    expect(can(['cashier'], 'fees.collect')).toBe(true);
    expect(can(['cashier'], 'fees.read')).toBe(true);
    expect(can(['cashier'], 'fees.reverse')).toBe(false);
    expect(can(['cashier'], 'sms.send')).toBe(false);
  });

  it('keeps teachers and gatekeepers away from money', () => {
    for (const role of ['teacher', 'gatekeeper'] as const) {
      expect(can([role], 'fees.read')).toBe(false);
      expect(can([role], 'fees.collect')).toBe(false);
    }
  });
});

describe('payment requests', () => {
  it('requires an idempotency key of safe characters', () => {
    expect(idempotencyKeySchema.safeParse(ATTEMPT).success).toBe(true);
    expect(idempotencyKeySchema.safeParse('short').success).toBe(false);
    expect(idempotencyKeySchema.safeParse('has space in it 1234').success).toBe(false);
  });

  it('accepts whole cents only and caps lines', () => {
    const base = { studentId: ID, lineIds: [ID], cashReceivedCents: 250000, idempotencyKey: ATTEMPT };
    expect(cashPaymentSchema.safeParse(base).success).toBe(true);
    expect(cashPaymentSchema.safeParse({ ...base, cashReceivedCents: 2500.5 }).success).toBe(false);
    expect(cashPaymentSchema.safeParse({ ...base, cashReceivedCents: -1 }).success).toBe(false);
    expect(cashPaymentSchema.safeParse({ ...base, lineIds: [] }).success).toBe(false);
    expect(
      cashPaymentSchema.safeParse({ ...base, lineIds: Array.from({ length: 25 }, () => ID) })
        .success,
    ).toBe(false);
  });

  it('never lets a client send a status or an amount for cash', () => {
    const base = { studentId: ID, lineIds: [ID], cashReceivedCents: 1, idempotencyKey: ATTEMPT };
    expect(cashPaymentSchema.safeParse({ ...base, status: 'paid' }).success).toBe(false);
    expect(cashPaymentSchema.safeParse({ ...base, amountCents: 1 }).success).toBe(false);
  });

  it('needs a reference for manual payments', () => {
    const m = {
      studentId: ID,
      lineIds: [ID],
      kind: 'cheque',
      receivedOn: '2026-10-04',
      idempotencyKey: ATTEMPT,
    };
    expect(manualPaymentSchema.safeParse(m).success).toBe(false);
    expect(manualPaymentSchema.safeParse({ ...m, reference: 'CHQ 001234' }).success).toBe(true);
  });
});

describe('slips (ADR 0009)', () => {
  it('limits type and size', () => {
    expect(
      slipUploadRequestSchema.safeParse({ contentType: 'image/jpeg', sizeBytes: 1000 }).success,
    ).toBe(true);
    expect(
      slipUploadRequestSchema.safeParse({ contentType: 'application/pdf', sizeBytes: 1000 })
        .success,
    ).toBe(false);
    expect(
      slipUploadRequestSchema.safeParse({ contentType: 'image/png', sizeBytes: SLIP_MAX_BYTES + 1 })
        .success,
    ).toBe(false);
  });

  it('requires a positive amount and a reference', () => {
    const s = {
      uploadId: ID,
      lineIds: [ID],
      amountCents: 250000,
      reference: 'TRX123',
      slipDate: '2026-10-03',
    };
    expect(submitSlipSchema.safeParse(s).success).toBe(true);
    expect(submitSlipSchema.safeParse({ ...s, amountCents: 0 }).success).toBe(false);
    expect(submitSlipSchema.safeParse({ ...s, reference: 'x' }).success).toBe(false);
  });
});

describe('PayHere', () => {
  const notify = {
    merchant_id: '1211149',
    order_id: ID,
    payment_id: '320025071278',
    payhere_amount: '2500.00',
    payhere_currency: 'LKR',
    status_code: '2',
    md5sig: 'A'.repeat(32),
  };

  it('parses a notify body and keeps the amount as a 2-decimal string', () => {
    expect(payhereNotifySchema.safeParse(notify).success).toBe(true);
    expect(payhereNotifySchema.safeParse({ ...notify, payhere_amount: '2500' }).success).toBe(
      false,
    );
    expect(payhereNotifySchema.safeParse({ ...notify, order_id: 'not-a-uuid' }).success).toBe(
      false,
    );
    expect(payhereNotifySchema.safeParse({ ...notify, md5sig: 'xyz' }).success).toBe(false);
  });

  it('keeps the merchant secret write-only and the id numeric', () => {
    expect(updatePayhereSettingsSchema.safeParse({ merchantId: 'abc' }).success).toBe(false);
    expect(
      updatePayhereSettingsSchema.safeParse({ merchantId: '1211149', merchantSecret: 's3cr3t-val' })
        .success,
    ).toBe(true);
  });
});

describe('fee settings', () => {
  it('keeps the due day inside every month', () => {
    expect(updateFeeSettingsSchema.safeParse({ dueDay: 28 }).success).toBe(true);
    expect(updateFeeSettingsSchema.safeParse({ dueDay: 31 }).success).toBe(false);
    expect(updateFeeSettingsSchema.safeParse({}).success).toBe(false);
  });
});

describe('SMS cost', () => {
  it('takes the segment price from the add-on list', () => {
    expect(SMS_SEGMENT_PRICE_CENTS).toBe(ADDONS.sms.price);
  });

  it('counts GSM-7 and Unicode segments', () => {
    expect(smsSegments('')).toBe(0);
    expect(smsSegments('a'.repeat(160))).toBe(1);
    expect(smsSegments('a'.repeat(161))).toBe(2);
    expect(smsSegments('ගාස්තු'.repeat(11))).toBe(1);
    expect(smsSegments('ගාස්තු'.repeat(12))).toBe(2);
  });
});

describe('registry', () => {
  it('keeps money mutations on POST/PATCH with a request schema', () => {
    for (const name of [
      'recordCashPayment',
      'recordManualPayment',
      'reversePayment',
      'approveSlip',
    ] as const) {
      expect(API[name].method).toBe('POST');
      expect('request' in API[name]).toBe(true);
    }
  });
});
