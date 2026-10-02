import { CallRecorder } from '../recorder';
import type {
  CheckoutSession,
  CreateCheckoutInput,
  PaymentProvider,
  VerifiedPaymentNotification,
} from './payment.provider';

/**
 * In-memory {@link PaymentProvider}. Checkouts are idempotent per key. A notification verifies
 * when its `signature` field equals {@link MockPaymentProvider.SIGNATURE}; anything else is
 * treated as forged.
 */
export class MockPaymentProvider
  extends CallRecorder<'createCheckout' | 'verifyNotification'>
  implements PaymentProvider
{
  static readonly SIGNATURE = 'valid-mock-signature';
  private readonly checkouts = new Map<string, CheckoutSession>();

  async createCheckout(input: CreateCheckoutInput): Promise<CheckoutSession> {
    await this.record('createCheckout', input);
    if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) {
      throw new RangeError('amountCents must be a positive integer');
    }
    const key = `${input.tenantId}:${input.idempotencyKey}`;
    const existing = this.checkouts.get(key);
    if (existing) return existing;

    const session: CheckoutSession = {
      method: 'POST',
      actionUrl: 'https://payments.mock.invalid/checkout',
      fields: {
        merchant_id: input.merchant.merchantId,
        order_id: input.orderId,
        amount: (input.amountCents / 100).toFixed(2),
        currency: input.currency,
        notify_url: input.notifyUrl,
        hash: 'MOCKHASH',
      },
    };
    this.checkouts.set(key, session);
    return session;
  }

  async verifyNotification(input: {
    payload: Readonly<Record<string, string>>;
  }): Promise<VerifiedPaymentNotification | null> {
    await this.record('verifyNotification', input);
    const p = input.payload;
    if (
      p.signature !== MockPaymentProvider.SIGNATURE ||
      !p.order_id ||
      !p.payment_id ||
      !p.amount
    ) {
      return null;
    }
    return {
      orderId: p.order_id,
      providerPaymentId: p.payment_id,
      amountCents: Math.round(Number(p.amount) * 100),
      currency: p.currency ?? 'LKR',
      status: p.status === 'success' ? 'success' : 'failed',
    };
  }
}
