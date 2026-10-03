import type { SmsProvider } from '../../integrations/sms/sms.provider';
import type { JobProcessor } from '../queues';

/**
 * `sms` queue processor: sends one message through the {@link SmsProvider}. Idempotent: the
 * provider receives `<tenantId>:<messageId>` as its idempotency key, so a retry (or a stalled
 * job that runs twice) is sent once. Provider errors propagate, which makes BullMQ retry with
 * backoff; after the last attempt the job stays in the failed set.
 */
export function createSmsProcessor(provider: SmsProvider): JobProcessor<'sms'> {
  return async (payload) => {
    await provider.send({
      tenantId: payload.tenantId,
      sender: {
        gateway: payload.gateway,
        senderId: payload.senderId,
        ...(payload.credentialsRef ? { credentialsRef: payload.credentialsRef } : {}),
      },
      to: payload.to,
      text: payload.text,
      idempotencyKey: `${payload.tenantId}:${payload.messageId}`,
    });
  };
}
