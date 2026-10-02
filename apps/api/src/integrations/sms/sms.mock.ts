import { CallRecorder } from '../recorder';
import {
  smsSegments,
  type SendSmsInput,
  type SendSmsResult,
  type SmsProvider,
} from './sms.provider';

/** In-memory {@link SmsProvider}: records messages; idempotent per (tenant, key). */
export class MockSmsProvider extends CallRecorder<'send'> implements SmsProvider {
  private readonly sent = new Map<string, SendSmsResult>();

  async send(input: SendSmsInput): Promise<SendSmsResult> {
    await this.record('send', input);
    const key = `${input.tenantId}:${input.idempotencyKey}`;
    const existing = this.sent.get(key);
    if (existing) return existing;
    const result = {
      providerMessageId: `mock-sms-${this.sent.size + 1}`,
      segments: smsSegments(input.text),
    };
    this.sent.set(key, result);
    return result;
  }

  /** Distinct messages actually "delivered" (retries with the same key count once). */
  get delivered(): number {
    return this.sent.size;
  }
}
