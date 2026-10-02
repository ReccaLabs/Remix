import { Global, Module } from '@nestjs/common';
import { MockEmailProvider } from './email/email.mock';
import { EMAIL_PROVIDER } from './email/email.provider';
import { MockMeetingProvider } from './meeting/meeting.mock';
import { MEETING_PROVIDER } from './meeting/meeting.provider';
import { MockPaymentProvider } from './payment/payment.mock';
import { PAYMENT_PROVIDER } from './payment/payment.provider';
import { MockSmsProvider } from './sms/sms.mock';
import { SMS_PROVIDER } from './sms/sms.provider';
import { MockStorageProvider } from './storage/storage.mock';
import { STORAGE_PROVIDER } from './storage/storage.provider';
import { MockVideoProvider } from './video/video.mock';
import { VIDEO_PROVIDER } from './video/video.provider';

/**
 * Binds every provider token to its in-memory mock. For tests (and local dev until the real
 * adapters exist) — never imported by the production `AppModule`, so a missing real adapter
 * fails DI at boot instead of silently "sending" nothing.
 */
@Global()
@Module({
  providers: [
    { provide: PAYMENT_PROVIDER, useFactory: () => new MockPaymentProvider() },
    { provide: SMS_PROVIDER, useFactory: () => new MockSmsProvider() },
    { provide: VIDEO_PROVIDER, useFactory: () => new MockVideoProvider() },
    { provide: MEETING_PROVIDER, useFactory: () => new MockMeetingProvider() },
    { provide: STORAGE_PROVIDER, useFactory: () => new MockStorageProvider() },
    { provide: EMAIL_PROVIDER, useFactory: () => new MockEmailProvider() },
  ],
  exports: [
    PAYMENT_PROVIDER,
    SMS_PROVIDER,
    VIDEO_PROVIDER,
    MEETING_PROVIDER,
    STORAGE_PROVIDER,
    EMAIL_PROVIDER,
  ],
})
export class MockIntegrationsModule {}
