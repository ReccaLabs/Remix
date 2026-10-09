import { createHash } from 'node:crypto';
import { smsSegments } from '@remix/types/api';
import {
  asRecord,
  type FetchLike,
  PLATFORM_SENDER_ID,
  postWithTimeout,
  toGatewayNumber,
} from './sms-http';
import { SmsRejectedError, SmsTransportError } from './sms-errors';
import type { SendSmsInput, SendSmsResult, SmsProvider } from './sms.provider';

export const NOTIFY_LK_URL = 'https://app.notify.lk/api/v1/send';
const GATEWAY = 'notify.lk';

export interface NotifyLkOptions {
  userId: string;
  apiKey: string;
  /** The platform's approved Sender ID, used when the message asks for the platform sender. */
  senderId: string;
  timeoutMs: number;
  fetch?: FetchLike;
}

/**
 * Notify.lk v1 adapter (https://developer.notify.lk/api-endpoints, read 2026-10): POST form
 * `user_id, api_key, sender_id, to=947XXXXXXXX, message[, type=unicode]`; success body
 * `{"status":"success","data":"Sent"}`. Credentials go in the POST body, never the URL.
 *
 * ASSUMED (the docs show no failure body, error codes or message id): a failure is any
 * non-success status/body; there is no message id or idempotency support, so the provider
 * message id is derived from the idempotency key and "sent once" comes from the BullMQ job id.
 * A rejection is concluded only for a 4xx other than 401/403/429, or a 200 whose message talks
 * about the number; everything else is a transport/account problem (retry, fail over).
 */
export class NotifyLkSmsProvider implements SmsProvider {
  private readonly fetchImpl: FetchLike;
  constructor(private readonly options: NotifyLkOptions) {
    this.fetchImpl = options.fetch ?? fetch;
  }

  async send(input: SendSmsInput): Promise<SendSmsResult> {
    const unicode = /[^\x20-\x7e\n\r]/.test(input.text);
    const form = new URLSearchParams({
      user_id: this.options.userId,
      api_key: this.options.apiKey,
      sender_id:
        input.sender.senderId === PLATFORM_SENDER_ID
          ? this.options.senderId
          : input.sender.senderId,
      to: toGatewayNumber(input.to),
      message: input.text,
    });
    if (unicode) form.set('type', 'unicode');
    const { status, body } = await postWithTimeout(
      GATEWAY,
      this.fetchImpl,
      NOTIFY_LK_URL,
      {
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          accept: 'application/json',
        },
        body: form.toString(),
      },
      this.options.timeoutMs,
    );
    const json = asRecord(body);
    const message = typeof json.data === 'string' ? json.data : '';
    if (status === 200 && json.status === 'success') {
      const digest = createHash('sha256')
        .update(`${input.tenantId}:${input.idempotencyKey}`)
        .digest('hex')
        .slice(0, 24);
      return { providerMessageId: `notifylk-${digest}`, segments: smsSegments(input.text) };
    }
    if (status >= 500 || status === 401 || status === 403 || status === 429) {
      throw new SmsTransportError(GATEWAY, `HTTP ${status}`);
    }
    if (status >= 400 || /number|recipient|invalid.*to\b/i.test(message)) {
      throw new SmsRejectedError(GATEWAY, message.slice(0, 120) || `HTTP ${status}`);
    }
    // 200 with a body we do not understand (credit, sender id, outage): not the recipient's
    // fault, so retry and fail over.
    throw new SmsTransportError(GATEWAY, message.slice(0, 120) || 'unexpected response');
  }
}
