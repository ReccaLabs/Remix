import { describe, expect, it } from 'vitest';
import { PayhereCheckoutBuilder, type PayhereCheckoutInput } from './payhere-checkout-builder';

// Official JS sample inputs, frozen output computed independently:
// https://support.payhere.lk/api-%26-mobile-sdk/checkout-api.I (Generating 'hash' Value)
const sample: PayhereCheckoutInput = {
  merchantId: '2xxxxx',
  merchantSecret: 'xxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
  orderId: '12345',
  amountCents: 100000,
  mode: 'sandbox',
  origin: 'https://sample.example',
  tenantSlug: 'sample',
  customer: {
    firstName: 'Sample',
    lastName: 'Owner',
    email: 'owner@example.test',
    phone: '+94771234567',
    address: 'Sample address',
    city: 'Colombo',
  },
};
describe('SET-02 PayHere checkout signing', () => {
  const builder = new PayhereCheckoutBuilder();
  it('matches PayHere’s documented JS sample including uppercase inner and outer MD5', () => {
    expect(builder.build(sample).fields.hash).toBe('062BB799DEFA336240047CC7C2091B2F');
  });
  it('formats integer cents with exactly two decimal places and no separators', () => {
    for (const [cents, amount] of [
      [0, '0.00'],
      [1, '0.01'],
      [1000, '10.00'],
      [123456789, '1234567.89'],
    ] as const) {
      expect(builder.build({ ...sample, amountCents: cents }).fields.amount).toBe(amount);
    }
    for (const amountCents of [-1, 0.5, NaN, Number.MAX_SAFE_INTEGER + 1])
      expect(() => builder.build({ ...sample, amountCents })).toThrow();
  });
  it('uses the correct gateway, tenant callback, and never returns the secret', () => {
    const checkout = builder.build({ ...sample, mode: 'live' });
    expect(checkout.actionUrl).toBe('https://www.payhere.lk/pay/checkout');
    expect(checkout.fields.notify_url).toBe(
      'https://sample.example/api/v1/webhooks/payhere/sample',
    );
    expect(JSON.stringify(checkout)).not.toContain(sample.merchantSecret);
  });
});
