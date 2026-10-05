import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type { CheckoutResponse } from '@remix/types/api';

export interface PayhereCheckoutInput {
  merchantId: string;
  merchantSecret: string;
  mode: 'sandbox' | 'live';
  orderId: string;
  amountCents: number;
  origin: string;
  tenantSlug: string;
  customer: {
    firstName: string;
    lastName: string;
    email: string;
    phone: string;
    address: string;
    city: string;
  };
}
const md5 = (text: string) => createHash('md5').update(text, 'utf8').digest('hex').toUpperCase();

/** Pure signing seam for 3-E; MD5 is PayHere's wire protocol, never password encryption. */
@Injectable()
export class PayhereCheckoutBuilder {
  build(input: PayhereCheckoutInput): CheckoutResponse {
    if (!Number.isSafeInteger(input.amountCents) || input.amountCents < 0)
      throw new RangeError('Use non-negative integer cents');
    const amount = `${Math.floor(input.amountCents / 100)}.${String(input.amountCents % 100).padStart(2, '0')}`;
    return {
      checkoutId: input.orderId,
      actionUrl:
        input.mode === 'sandbox'
          ? 'https://sandbox.payhere.lk/pay/checkout'
          : 'https://www.payhere.lk/pay/checkout',
      fields: {
        merchant_id: input.merchantId,
        order_id: input.orderId,
        amount,
        currency: 'LKR',
        hash: md5(input.merchantId + input.orderId + amount + 'LKR' + md5(input.merchantSecret)),
        return_url: `${input.origin}/admin/settings/payments`,
        cancel_url: `${input.origin}/admin/settings/payments`,
        notify_url: `${input.origin}/api/v1/webhooks/payhere/${input.tenantSlug}`,
        items: 'ReMix integration test',
        first_name: input.customer.firstName,
        last_name: input.customer.lastName,
        email: input.customer.email,
        phone: input.customer.phone,
        address: input.customer.address,
        city: input.customer.city,
        country: 'Sri Lanka',
        custom_1: 'settings-test',
      },
    };
  }
}
