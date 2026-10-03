import { Logger } from '@nestjs/common';
import type { AppConfig } from '../../config/config';
import { MockSmsProvider } from './sms.mock';
import type { SendSmsResult, SmsProvider } from './sms.provider';

/**
 * Production stand-in until a real gateway adapter (Text.lk, R2) exists. It sends nothing and
 * throws, so jobs fail visibly into the failed set instead of being silently "delivered" by a
 * mock.
 */
export class UnconfiguredSmsProvider implements SmsProvider {
  send(): Promise<SendSmsResult> {
    return Promise.reject(new Error('No SMS gateway adapter is configured'));
  }
}

/**
 * The SMS provider for a process: the logging mock outside production (codes are visible in the
 * worker log and in `calls`), {@link UnconfiguredSmsProvider} in production. The mock can never
 * be selected in production.
 */
export function smsProviderBinding(config: AppConfig): SmsProvider {
  if (config.nodeEnv === 'production') return new UnconfiguredSmsProvider();
  const logger = new Logger('MockSms');
  return new MockSmsProvider({
    log:
      config.nodeEnv === 'development'
        ? (line) => {
            logger.log(line);
          }
        : undefined,
  });
}
