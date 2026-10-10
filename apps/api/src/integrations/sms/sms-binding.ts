import { Logger } from '@nestjs/common';
import type { AppConfig, SmsConfig, SmsGatewayName } from '../../config/config';
import { FailoverSmsProvider } from './failover-sms.provider';
import { NotifyLkSmsProvider } from './notify-lk.provider';
import { MockSmsProvider } from './sms.mock';
import type { SendSmsResult, SmsProvider } from './sms.provider';
import { TextLkSmsProvider } from './text-lk.provider';

/**
 * Production stand-in when no gateway has credentials. It sends nothing and throws, so jobs
 * fail visibly into the failed set instead of being silently "delivered" by a mock.
 */
export class UnconfiguredSmsProvider implements SmsProvider {
  send(): Promise<SendSmsResult> {
    return Promise.reject(new Error('No SMS gateway adapter is configured'));
  }
}

function gateway(name: SmsGatewayName, sms: SmsConfig): SmsProvider | undefined {
  if (name === 'notifylk') {
    return sms.notifyLk ? new NotifyLkSmsProvider({ ...sms.notifyLk, timeoutMs: sms.timeoutMs }) : undefined;
  }
  return sms.textLk ? new TextLkSmsProvider({ ...sms.textLk, timeoutMs: sms.timeoutMs }) : undefined;
}

/**
 * The configured real gateways (primary, then fallback) as one provider, or undefined when none
 * has credentials. With only one configured, that one is used on its own.
 */
export function realSmsProvider(sms: SmsConfig): SmsProvider | undefined {
  const primary = gateway(sms.primary, sms);
  const fallback = sms.fallback ? gateway(sms.fallback, sms) : undefined;
  if (primary && fallback) return new FailoverSmsProvider(primary, fallback);
  return primary ?? fallback;
}

/**
 * The SMS provider for a process: real gateways whenever they are configured (any environment,
 * so staging can use a test account), otherwise the logging mock outside production (codes are
 * visible in the worker log and in `calls`) and {@link UnconfiguredSmsProvider} in production.
 * The mock can never be selected in production.
 */
export function smsProviderBinding(config: AppConfig): SmsProvider {
  const real = realSmsProvider(config.sms);
  if (real) return real;
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
