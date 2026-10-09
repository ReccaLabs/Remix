import { Logger } from '@nestjs/common';
import { UnrecoverableError } from 'bullmq';
import { SmsRejectedError } from '../../integrations/sms/sms-errors';
import type { SmsProvider } from '../../integrations/sms/sms.provider';
import { DEFAULT_JOB_OPTIONS, type JobProcessor } from '../queues';

/** DI token for {@link SmsBilling} (provided in the worker when the database is configured). */
export const SMS_BILLING = Symbol('SmsBilling');

/**
 * What the `sms` worker tells the wallet about messages that were billed (`billed: true`).
 * Both calls are idempotent and never throw for "already done".
 */
export interface SmsBilling {
  onSent(tenantId: string, messageId: string): Promise<void>;
  /** The message will never be sent: give the debit back. */
  onPermanentFailure(tenantId: string, messageId: string): Promise<void>;
}

/**
 * `sms` queue processor: sends one message through the {@link SmsProvider}. Idempotent: the
 * provider receives `<tenantId>:<messageId>` as its idempotency key, so a retry (or a stalled
 * job that runs twice) is sent once. Provider errors propagate, which makes BullMQ retry with
 * backoff; after the last attempt the job stays in the failed set.
 *
 * Wallet-billed messages (MSG-02) are marked sent on success and refunded when the failure is
 * permanent: a definite gateway rejection (stops retrying at once) or the last retry attempt.
 */
export function createSmsProcessor(provider: SmsProvider, billing?: SmsBilling): JobProcessor<'sms'> {
  const logger = new Logger('SmsJobs');
  return async (payload, ctx) => {
    try {
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
    } catch (error) {
      const rejected = error instanceof SmsRejectedError;
      if (payload.billed && billing && (rejected || (ctx?.attempt ?? 1) >= DEFAULT_JOB_OPTIONS.attempts)) {
        try {
          await billing.onPermanentFailure(payload.tenantId, payload.messageId);
        } catch {
          // Surfaces in the failed set and logs; the job must still end (no endless retries).
          logger.error({ tenantId: payload.tenantId, messageId: payload.messageId }, 'SMS refund failed');
        }
      }
      // Retrying a refused number cannot help (and OTP jobs have no wallet to refund).
      if (rejected) throw new UnrecoverableError(error.message);
      throw error;
    }
    if (payload.billed && billing) {
      // The SMS is out: a bookkeeping error must not make BullMQ retry and send it again.
      try {
        await billing.onSent(payload.tenantId, payload.messageId);
      } catch {
        logger.error({ tenantId: payload.tenantId, messageId: payload.messageId }, 'Could not mark SMS as sent');
      }
    }
  };
}
