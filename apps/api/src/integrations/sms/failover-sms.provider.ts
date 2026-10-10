import { Logger } from '@nestjs/common';
import { SmsTransportError } from './sms-errors';
import { maskPhone } from './sms-http';
import type { SendSmsInput, SendSmsResult, SmsProvider } from './sms.provider';

/**
 * Primary gateway first; on a transport/5xx/account error ({@link SmsTransportError}) try the
 * fallback. A definite rejection (`SmsRejectedError`) or any other error propagates
 * immediately: another gateway would refuse the same number. If both fail, the fallback's
 * error propagates so BullMQ retries the whole send.
 */
export class FailoverSmsProvider implements SmsProvider {
  private readonly logger = new Logger('SmsFailover');
  constructor(
    private readonly primary: SmsProvider,
    private readonly fallback: SmsProvider,
  ) {}

  async send(input: SendSmsInput): Promise<SendSmsResult> {
    try {
      return await this.primary.send(input);
    } catch (error) {
      if (!(error instanceof SmsTransportError)) throw error;
      this.logger.warn(
        `Primary SMS gateway failed (${error.gateway}); trying fallback for ${maskPhone(input.to)}`,
      );
      return this.fallback.send(input);
    }
  }
}
