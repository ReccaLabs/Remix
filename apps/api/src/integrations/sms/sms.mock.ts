import { CallRecorder } from '../recorder';
import {
  smsSegments,
  type SendSmsInput,
  type SendSmsResult,
  type SmsProvider,
} from './sms.provider';

export interface MockSmsOptions {
  /**
   * Called with a one-line description of every message, **including its text** (so a developer
   * can read an OTP code). Wired to the logger in development only; the mock is never bound
   * in production (see `smsProviderBinding`).
   */
  log?: (line: string) => void;
}

/** In-memory {@link SmsProvider}: records messages; idempotent per (tenant, key). */
export class MockSmsProvider extends CallRecorder<'send'> implements SmsProvider {
  private readonly sent = new Map<string, SendSmsResult>();

  constructor(private readonly options: MockSmsOptions = {}) {
    super();
  }

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
    this.options.log?.(
      `[mock sms] to=${input.to} sender=${input.sender.senderId} text=${input.text}`,
    );
    return result;
  }

  /** Distinct messages actually "delivered" (retries with the same key count once). */
  get delivered(): number {
    return this.sent.size;
  }
}
