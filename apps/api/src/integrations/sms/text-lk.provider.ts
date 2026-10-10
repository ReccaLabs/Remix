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

export const TEXT_LK_URL = 'https://app.text.lk/api/v3/sms/send';
const GATEWAY = 'text.lk';

export interface TextLkOptions {
  apiToken: string;
  senderId: string;
  timeoutMs: number;
  fetch?: FetchLike;
}

/**
 * Text.lk v3 adapter (https://text.lk/docs/send-sms/, read 2026-10): POST JSON
 * `{recipient, sender_id, type:"plain", message}` with `Authorization: Bearer <token>`; success
 * `{status:"success", data:{uid, to, from, message, status, cost, sms_count}}`, failure
 * `{status:"error", message}`.
 *
 * ASSUMED (the docs list no HTTP status codes): a 4xx other than 401/403/429 means the request
 * itself was refused (bad number or content) and is permanent; 401/403/429/5xx are account or
 * outage problems and fail over. The gateway's `sms_count` wins over our own estimate. No
 * idempotency support: "sent once" comes from the BullMQ job id.
 */
export class TextLkSmsProvider implements SmsProvider {
  private readonly fetchImpl: FetchLike;
  constructor(private readonly options: TextLkOptions) {
    this.fetchImpl = options.fetch ?? fetch;
  }

  async send(input: SendSmsInput): Promise<SendSmsResult> {
    const { status, body } = await postWithTimeout(
      GATEWAY,
      this.fetchImpl,
      TEXT_LK_URL,
      {
        headers: {
          authorization: `Bearer ${this.options.apiToken}`,
          'content-type': 'application/json',
          accept: 'application/json',
        },
        body: JSON.stringify({
          recipient: toGatewayNumber(input.to),
          sender_id:
            input.sender.senderId === PLATFORM_SENDER_ID
              ? this.options.senderId
              : input.sender.senderId,
          type: 'plain',
          message: input.text,
        }),
      },
      this.options.timeoutMs,
    );
    const json = asRecord(body);
    if (status >= 200 && status < 300 && json.status === 'success') {
      const data = asRecord(json.data);
      const uid =
        typeof data.uid === 'string' || typeof data.uid === 'number' ? String(data.uid) : '';
      if (!uid) throw new SmsTransportError(GATEWAY, 'success without a message id');
      const count = Number(data.sms_count);
      return {
        providerMessageId: uid,
        segments: Number.isInteger(count) && count > 0 ? count : smsSegments(input.text),
      };
    }
    if (status >= 500 || status === 401 || status === 403 || status === 429) {
      throw new SmsTransportError(GATEWAY, `HTTP ${status}`);
    }
    const message = typeof json.message === 'string' ? json.message : '';
    if (status >= 400) {
      throw new SmsRejectedError(GATEWAY, message.slice(0, 120) || `HTTP ${status}`);
    }
    throw new SmsTransportError(GATEWAY, message.slice(0, 120) || 'unexpected response');
  }
}
