import { CallRecorder } from '../recorder';
import type { EmailProvider, SendEmailInput } from './email.provider';

/** In-memory {@link EmailProvider}: records messages; idempotent per key. */
export class MockEmailProvider extends CallRecorder<'send'> implements EmailProvider {
  private readonly sent = new Map<string, string>();

  async send(input: SendEmailInput): Promise<{ messageId: string }> {
    await this.record('send', input);
    if (input.to.length === 0) throw new RangeError('At least one recipient is required');
    let messageId = this.sent.get(input.idempotencyKey);
    if (!messageId) {
      messageId = `mock-email-${this.sent.size + 1}`;
      this.sent.set(input.idempotencyKey, messageId);
    }
    return { messageId };
  }
}
