import type { Cents } from '@remix/types/money';

/**
 * Which gateway sends for a tenant: the ReMix wallet (platform Text.lk account, debited per
 * segment) or the institute's own gateway (R2, SSRF-guarded generic HTTP adapter).
 */
export interface SmsSenderConfig {
  gateway: 'remix-wallet' | 'textlk' | 'byo-http';
  /** Approved sender mask shown on the phone, e.g. `KamalPhys`. */
  senderId: string;
  /** Reference to the encrypted credentials row (never the secret itself). */
  credentialsRef?: string;
}

export interface SendSmsInput {
  tenantId: string;
  sender: SmsSenderConfig;
  /** E.164 Sri Lankan mobile (`+947XXXXXXXX`), already validated with `sriLankaMobile`. */
  to: string;
  /** Unicode allowed (Sinhala/Tamil → UCS-2, 70 chars per segment). */
  text: string;
  /** Same key → sent once, even if the job is retried. */
  idempotencyKey: string;
}

export interface SendSmsResult {
  providerMessageId: string;
  segments: number;
  /** Cost charged by the gateway, when it reports one. */
  costCents?: Cents;
}

export interface SmsProvider {
  send(input: SendSmsInput): Promise<SendSmsResult>;
}

/** DI token for {@link SmsProvider}. */
export const SMS_PROVIDER = Symbol('SmsProvider');

/**
 * Segment count for billing estimates: plain ASCII is treated as GSM-7 (160 single / 153 per
 * part), anything else (Sinhala, Tamil, emoji) as UCS-2 (70 / 67). The gateway's count wins.
 */
export function smsSegments(text: string): number {
  // UCS-2 limits count UTF-16 code units, which is exactly `String#length`.
  const ucs2 = /[^\x20-\x7e\n\r]/.test(text);
  const [single, multi] = ucs2 ? [70, 67] : [160, 153];
  if (text.length <= single) return 1;
  return Math.ceil(text.length / multi);
}
