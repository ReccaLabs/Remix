import { describe, expect, it } from 'vitest';
import type { CreateCheckoutInput, PayHereMerchantConfig } from './payment.provider';
import {
  checkoutHash,
  notifySignature,
  parsePayhereAmount,
  payhereAmount,
  PayherePaymentProvider,
  sameDigest,
} from './payhere.provider';

// Vectors computed independently (Python hashlib) from PayHere's documented formulas:
// https://support.payhere.lk/api-&-mobile-sdk/checkout-api ("Generating hash", "md5sig").
const ORDER = '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b';
const SECRET = 'test-only-secret-1234';
const merchant: PayHereMerchantConfig = {
  provider: 'payhere',
  merchantId: '1211149',
  merchantSecret: SECRET,
  sandbox: true,
};
const notify = {
  merchant_id: '1211149',
  order_id: ORDER,
  payment_id: '320032000001',
  payhere_amount: '2500.00',
  payhere_currency: 'LKR',
  status_code: '2',
  md5sig: 'E6907DE107B10A3FCCFF95FA02A3C8D4',
};
const checkout: CreateCheckoutInput = {
  tenantId: '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5c',
  merchant,
  orderId: ORDER,
  amountCents: 250_000,
  currency: 'LKR',
  description: 'Fees IS-0001 2026-10',
  customer: { firstName: 'Sample', lastName: 'Student', phone: '+94771234567' },
  returnUrl: 'https://sample.remix.lk/app/pay/return?checkout=x',
  cancelUrl: 'https://sample.remix.lk/app/pay/cancel?checkout=x',
  notifyUrl: 'https://sample.remix.lk/api/v1/webhooks/payhere/sample',
  idempotencyKey: ORDER,
};
const provider = new PayherePaymentProvider();
const verify = (payload: Record<string, string>, m = merchant) =>
  provider.verifyNotification({ tenantId: checkout.tenantId, merchant: m, payload });

describe('FEE-04 PayHere signing', () => {
  it('matches the documented checkout hash sample (upper-case inner and outer MD5)', () => {
    expect(checkoutHash('2xxxxx', '12345', '1000.00', 'LKR', 'xxxxxxxxxxxxxxxxxxxxxxxxxxxxx')).toBe(
      '062BB799DEFA336240047CC7C2091B2F',
    );
  });

  it('matches an independently computed notify md5sig', () => {
    expect(notifySignature(notify, SECRET)).toBe(notify.md5sig);
  });

  it('formats and parses amounts without floats', () => {
    for (const [cents, text] of [
      [0, '0.00'],
      [1, '0.01'],
      [1000, '10.00'],
      [123456789, '1234567.89'],
    ] as const) {
      expect(payhereAmount(cents)).toBe(text);
      expect(parsePayhereAmount(text)).toBe(cents);
    }
    for (const bad of [-1, 0.5, NaN, Number.MAX_SAFE_INTEGER + 1])
      expect(() => payhereAmount(bad)).toThrow(RangeError);
    for (const bad of ['10', '10.0', '1,000.00', '-1.00', '1e3.00', ' 1.00', '10.001'])
      expect(parsePayhereAmount(bad)).toBeNull();
  });

  it('compares digests case-insensitively and rejects different lengths', () => {
    expect(sameDigest(notify.md5sig, notify.md5sig.toLowerCase())).toBe(true);
    expect(sameDigest(notify.md5sig, notify.md5sig.slice(1))).toBe(false);
    expect(sameDigest(notify.md5sig, `${notify.md5sig.slice(0, -1)}0`)).toBe(false);
  });
});

describe('PayherePaymentProvider', () => {
  it('builds sandbox and live checkouts with the hash and never the secret', async () => {
    const sandbox = await provider.createCheckout(checkout);
    expect(sandbox.actionUrl).toBe('https://sandbox.payhere.lk/pay/checkout');
    expect(sandbox.fields).toMatchObject({
      merchant_id: '1211149',
      order_id: ORDER,
      amount: '2500.00',
      currency: 'LKR',
      notify_url: checkout.notifyUrl,
      return_url: checkout.returnUrl,
      cancel_url: checkout.cancelUrl,
      country: 'Sri Lanka',
      hash: checkoutHash('1211149', ORDER, '2500.00', 'LKR', SECRET),
    });
    expect(JSON.stringify(sandbox)).not.toContain(SECRET);
    const live = await provider.createCheckout({ ...checkout, merchant: { ...merchant, sandbox: false } });
    expect(live.actionUrl).toBe('https://www.payhere.lk/pay/checkout');
  });

  it('refuses zero, negative and fractional amounts', async () => {
    for (const amountCents of [0, -100, 10.5])
      await expect(provider.createCheckout({ ...checkout, amountCents })).rejects.toThrow(RangeError);
  });

  it('verifies a correctly signed notification', async () => {
    expect(await verify(notify)).toEqual({
      orderId: ORDER,
      providerPaymentId: '320032000001',
      amountCents: 250_000,
      currency: 'LKR',
      status: 'success',
    });
    expect(await verify({ ...notify, md5sig: notify.md5sig.toLowerCase() })).not.toBeNull();
  });

  it('maps every documented status code', async () => {
    const expected = { '0': 'pending', '-1': 'cancelled', '-2': 'failed', '-3': 'chargedback' };
    for (const [code, status] of Object.entries(expected)) {
      const payload = { ...notify, status_code: code };
      payload.md5sig = notifySignature(payload, SECRET);
      expect((await verify(payload))?.status).toBe(status);
    }
    const unknown = { ...notify, status_code: '5' };
    unknown.md5sig = notifySignature(unknown, SECRET);
    expect(await verify(unknown)).toBeNull();
  });

  it('rejects tampered fields, a wrong secret and a foreign merchant id', async () => {
    for (const change of [
      { payhere_amount: '25.00' },
      { payhere_currency: 'USD' },
      { status_code: '-2' },
      { order_id: '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5c' },
      { merchant_id: '1211150' },
      { md5sig: '0'.repeat(32) },
      { md5sig: 'not-hex' },
    ])
      expect(await verify({ ...notify, ...change })).toBeNull();
    expect(await verify(notify, { ...merchant, merchantSecret: 'other-secret' })).toBeNull();
    // Correctly signed with this secret, but for another merchant id.
    const foreign = { ...notify, merchant_id: '1211150' };
    foreign.md5sig = notifySignature(foreign, SECRET);
    expect(await verify(foreign)).toBeNull();
    const noPaymentId: Record<string, string> = { ...notify };
    delete noPaymentId.payment_id;
    expect(await verify(noPaymentId)).toBeNull();
  });
});
