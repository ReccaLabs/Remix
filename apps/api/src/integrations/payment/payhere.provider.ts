import { createHash, timingSafeEqual } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type {
  CheckoutSession,
  CreateCheckoutInput,
  PaymentMerchantConfig,
  PaymentProvider,
  PaymentStatus,
  VerifiedPaymentNotification,
} from './payment.provider';

/**
 * PayHere Checkout API (https://support.payhere.lk/api-&-mobile-sdk/checkout-api, checked
 * 2026-10-10). MD5 is PayHere's wire protocol, never used to protect anything of ours. Nothing
 * here logs: the secret, the hash inputs and the notify body (which may carry a masked card
 * number) stay inside these functions.
 */
export const PAYHERE_ACTIONS = {
  sandbox: 'https://sandbox.payhere.lk/pay/checkout',
  live: 'https://www.payhere.lk/pay/checkout',
} as const;

/** `status_code` of a notification. */
const STATUS_CODES: Readonly<Record<string, PaymentStatus>> = {
  '2': 'success',
  '0': 'pending',
  '-1': 'cancelled',
  '-2': 'failed',
  '-3': 'chargedback',
};

const md5Upper = (text: string) =>
  createHash('md5').update(text, 'utf8').digest('hex').toUpperCase();

/** Integer cents → PayHere amount: two decimals, no separators (`123456` → `1234.56`). */
export function payhereAmount(cents: number): string {
  if (!Number.isSafeInteger(cents) || cents < 0)
    throw new RangeError('Use non-negative integer cents');
  return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, '0')}`;
}

/** PayHere amount (`1234.56`) → integer cents; null for anything else (no float parsing). */
export function parsePayhereAmount(amount: string): number | null {
  const match = /^(\d{1,13})\.(\d{2})$/.exec(amount);
  if (!match) return null;
  const cents = Number(match[1]) * 100 + Number(match[2]);
  return Number.isSafeInteger(cents) ? cents : null;
}

/** hash = UPPER(MD5(merchant_id + order_id + amount + currency + UPPER(MD5(secret)))). */
export function checkoutHash(
  merchantId: string,
  orderId: string,
  amount: string,
  currency: string,
  secret: string,
): string {
  return md5Upper(merchantId + orderId + amount + currency + md5Upper(secret));
}

/**
 * md5sig = UPPER(MD5(merchant_id + order_id + payhere_amount + payhere_currency + status_code +
 * UPPER(MD5(secret)))).
 */
export function notifySignature(
  fields: {
    merchant_id: string;
    order_id: string;
    payhere_amount: string;
    payhere_currency: string;
    status_code: string;
  },
  secret: string,
): string {
  return md5Upper(
    fields.merchant_id +
      fields.order_id +
      fields.payhere_amount +
      fields.payhere_currency +
      fields.status_code +
      md5Upper(secret),
  );
}

/** Constant-time comparison of two hex digests (case-insensitive, length-checked first). */
export function sameDigest(expected: string, received: string): boolean {
  const a = Buffer.from(expected.toUpperCase(), 'utf8');
  const b = Buffer.from(received.toUpperCase(), 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}

/** The real PayHere adapter: pure signing and verification, no network calls. */
@Injectable()
export class PayherePaymentProvider implements PaymentProvider {
  createCheckout(input: CreateCheckoutInput): Promise<CheckoutSession> {
    if (!Number.isSafeInteger(input.amountCents) || input.amountCents <= 0)
      return Promise.reject(new RangeError('amountCents must be a positive integer'));
    const amount = payhereAmount(input.amountCents);
    const { merchant } = input;
    return Promise.resolve({
      method: 'POST',
      actionUrl: merchant.sandbox ? PAYHERE_ACTIONS.sandbox : PAYHERE_ACTIONS.live,
      fields: {
        merchant_id: merchant.merchantId,
        return_url: input.returnUrl,
        cancel_url: input.cancelUrl,
        notify_url: input.notifyUrl,
        order_id: input.orderId,
        items: input.description,
        currency: input.currency,
        amount,
        first_name: input.customer.firstName,
        last_name: input.customer.lastName,
        email: input.customer.email ?? '',
        phone: input.customer.phone,
        address: input.customer.address ?? '',
        city: input.customer.city ?? '',
        country: 'Sri Lanka',
        ...(input.tag ? { custom_1: input.tag } : {}),
        hash: checkoutHash(
          merchant.merchantId,
          input.orderId,
          amount,
          input.currency,
          merchant.merchantSecret,
        ),
      },
    });
  }

  /**
   * Null unless the signature matches this merchant's secret, the merchant id is this
   * merchant's, and the status code and amount are well formed. The caller still checks the
   * order, amount and currency against its own checkout.
   */
  verifyNotification(input: {
    tenantId: string;
    merchant: PaymentMerchantConfig;
    payload: Readonly<Record<string, string>>;
  }): Promise<VerifiedPaymentNotification | null> {
    const p = input.payload;
    const fields = {
      merchant_id: p.merchant_id ?? '',
      order_id: p.order_id ?? '',
      payhere_amount: p.payhere_amount ?? '',
      payhere_currency: p.payhere_currency ?? '',
      status_code: p.status_code ?? '',
    };
    const received = p.md5sig ?? '';
    if (!/^[A-Fa-f0-9]{32}$/.test(received)) return Promise.resolve(null);
    const signed = sameDigest(notifySignature(fields, input.merchant.merchantSecret), received);
    const status = STATUS_CODES[fields.status_code];
    const amountCents = parsePayhereAmount(fields.payhere_amount);
    if (
      !signed ||
      fields.merchant_id !== input.merchant.merchantId ||
      !status ||
      amountCents === null ||
      !fields.order_id ||
      !p.payment_id
    ) {
      return Promise.resolve(null);
    }
    return Promise.resolve({
      orderId: fields.order_id,
      providerPaymentId: p.payment_id,
      amountCents,
      currency: fields.payhere_currency,
      status,
    });
  }
}
