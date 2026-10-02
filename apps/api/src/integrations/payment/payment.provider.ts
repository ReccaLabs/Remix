import type { Cents } from '@remix/types/money';

/**
 * The institute's own PayHere merchant (each institute is paid directly — 03-architecture §7).
 * Secrets are stored encrypted and decrypted only for the call; never logged.
 */
export interface PayHereMerchantConfig {
  provider: 'payhere';
  merchantId: string;
  merchantSecret: string;
  sandbox: boolean;
}

export type PaymentMerchantConfig = PayHereMerchantConfig;

export interface CreateCheckoutInput {
  tenantId: string;
  merchant: PaymentMerchantConfig;
  /** Our invoice/payment-attempt id; echoed back in the notification. */
  orderId: string;
  amountCents: Cents;
  currency: 'LKR';
  description: string;
  customer: { firstName: string; lastName: string; phone: string; email?: string };
  returnUrl: string;
  cancelUrl: string;
  /** Server-to-server callback: `/api/v1/webhooks/payhere` on the tenant host. */
  notifyUrl: string;
  /** Same key → same checkout; a retried request never creates a second payment. */
  idempotencyKey: string;
}

/** PayHere checkout is a form POST from the browser to the gateway. */
export interface CheckoutSession {
  method: 'POST';
  actionUrl: string;
  /** Hidden form fields, including the merchant-secret hash. Contains no secret itself. */
  fields: Record<string, string>;
}

export type PaymentStatus = 'success' | 'pending' | 'cancelled' | 'failed' | 'chargedback';

/** A notification whose signature, merchant and amount format were verified. */
export interface VerifiedPaymentNotification {
  orderId: string;
  /** Provider's payment id — the idempotency key for processing the notification. */
  providerPaymentId: string;
  amountCents: Cents;
  currency: string;
  status: PaymentStatus;
}

export interface PaymentProvider {
  createCheckout(input: CreateCheckoutInput): Promise<CheckoutSession>;
  /**
   * Verify a gateway notification (PayHere: `md5sig` over merchant id, order, amount, currency,
   * status and the hashed secret). Returns null when the signature or merchant doesn't match —
   * the caller must then ignore the payload entirely.
   */
  verifyNotification(input: {
    tenantId: string;
    merchant: PaymentMerchantConfig;
    payload: Readonly<Record<string, string>>;
  }): Promise<VerifiedPaymentNotification | null>;
}

/** DI token for {@link PaymentProvider}. */
export const PAYMENT_PROVIDER = Symbol('PaymentProvider');
