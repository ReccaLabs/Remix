import { Inject, Injectable } from '@nestjs/common';
import { OTP_RULES, type OtpPurpose } from '@remix/types/api';
import { AppException } from '../../common/errors/app-exception';
import { JOB_PRODUCER, JobQueueUnavailableError, type JobProducer } from '../../jobs/job-producer';

/** Sender used for auth messages until per-institute SMS settings exist (Phase 6). */
const AUTH_SENDER = { gateway: 'remix-wallet', senderId: 'ReMix' } as const;

const MINUTES = Math.round(OTP_RULES.ttlSeconds / 60);

export type AuthMessage =
  | { kind: 'code'; purpose: OtpPurpose | 'two_step'; code: string; tenantName: string }
  | { kind: 'invite'; tenantName: string; link: string; expiresHours: number };

/** English text of an auth SMS. Never logged by the API; the worker logs it only in dev (mock). */
export function authSmsText(message: AuthMessage): string {
  if (message.kind === 'invite') {
    return `${message.tenantName} invited you to ReMix. Set your password here (link valid ${message.expiresHours} h): ${message.link}`;
  }
  const what =
    message.purpose === 'two_step'
      ? 'sign-in code'
      : message.purpose === 'unlock'
        ? 'unlock code'
        : 'password code';
  return `${message.code} is your ${message.tenantName} ${what}. It expires in ${MINUTES} minutes. Never share it.`;
}

/**
 * Auth SMS go through the `sms` job queue only (ADR 0012) — never sent inline. The job id is the
 * row id the message belongs to (challenge, ticket or invite), so a retried request cannot send
 * the same message twice. A queue outage is a 503: the caller's transaction rolls back and the
 * user retries; nothing is held in memory.
 */
@Injectable()
export class AuthSmsService {
  constructor(@Inject(JOB_PRODUCER) private readonly jobs: JobProducer) {}

  async send(tenantId: string, messageId: string, to: string, message: AuthMessage): Promise<void> {
    try {
      await this.jobs.add('sms', {
        tenantId,
        messageId,
        ...AUTH_SENDER,
        to,
        text: authSmsText(message),
      });
    } catch (error) {
      if (error instanceof JobQueueUnavailableError) {
        throw new AppException(
          'INTERNAL',
          503,
          'Service temporarily unavailable. Try again shortly.',
          {
            headers: { 'retry-after': '5' },
          },
        );
      }
      throw error;
    }
  }
}
