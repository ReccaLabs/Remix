import { Test } from '@nestjs/testing';
import { describe, expect, it } from 'vitest';
import { MockEmailProvider } from './email/email.mock';
import { EMAIL_PROVIDER } from './email/email.provider';
import { MockMeetingProvider } from './meeting/meeting.mock';
import { MEETING_PROVIDER } from './meeting/meeting.provider';
import { MockIntegrationsModule } from './mock-integrations.module';
import { MockPaymentProvider } from './payment/payment.mock';
import { PAYMENT_PROVIDER, type CreateCheckoutInput } from './payment/payment.provider';
import { MockSmsProvider } from './sms/sms.mock';
import { SMS_PROVIDER, smsSegments } from './sms/sms.provider';
import { MockStorageProvider } from './storage/storage.mock';
import {
  assertSignedUrlTtl,
  MAX_SIGNED_URL_TTL_SEC,
  STORAGE_PROVIDER,
  tenantObjectKey,
} from './storage/storage.provider';
import { MockVideoProvider } from './video/video.mock';
import { VIDEO_PROVIDER } from './video/video.provider';

const T1 = '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b';
const T2 = '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5c';
const NOW = Date.UTC(2026, 9, 1);

describe('MockIntegrationsModule', () => {
  it('binds every provider token to its mock', async () => {
    const ref = await Test.createTestingModule({ imports: [MockIntegrationsModule] }).compile();
    expect(ref.get(PAYMENT_PROVIDER)).toBeInstanceOf(MockPaymentProvider);
    expect(ref.get(SMS_PROVIDER)).toBeInstanceOf(MockSmsProvider);
    expect(ref.get(VIDEO_PROVIDER)).toBeInstanceOf(MockVideoProvider);
    expect(ref.get(MEETING_PROVIDER)).toBeInstanceOf(MockMeetingProvider);
    expect(ref.get(STORAGE_PROVIDER)).toBeInstanceOf(MockStorageProvider);
    expect(ref.get(EMAIL_PROVIDER)).toBeInstanceOf(MockEmailProvider);
  });
});

describe('MockPaymentProvider', () => {
  const checkout: CreateCheckoutInput = {
    tenantId: T1,
    merchant: { provider: 'payhere', merchantId: 'M1', merchantSecret: 'shh', sandbox: true },
    orderId: 'INV-1',
    amountCents: 250_000,
    currency: 'LKR',
    description: 'March fee',
    customer: { firstName: 'Sample', lastName: 'Student', phone: '+94771234567' },
    returnUrl: 'https://kamal.remix.lk/pay/done',
    cancelUrl: 'https://kamal.remix.lk/pay/cancel',
    notifyUrl: 'https://kamal.remix.lk/api/v1/webhooks/payhere',
    idempotencyKey: 'k1',
  };

  it('is idempotent per tenant + key and formats cents', async () => {
    const p = new MockPaymentProvider();
    const a = await p.createCheckout(checkout);
    expect(await p.createCheckout(checkout)).toBe(a);
    expect(a.fields.amount).toBe('2500.00');
    expect(JSON.stringify(a)).not.toContain('shh');
    expect(p.callsTo('createCheckout')).toHaveLength(2);
  });

  it('rejects non-integer amounts', async () => {
    await expect(
      new MockPaymentProvider().createCheckout({ ...checkout, amountCents: 10.5 }),
    ).rejects.toThrow(RangeError);
  });

  it('verifies only correctly signed notifications', async () => {
    const p = new MockPaymentProvider();
    const payload = { order_id: 'INV-1', payment_id: 'P9', amount: '2500.00', status: 'success' };
    expect(await p.verifyNotification({ payload: { ...payload, signature: 'forged' } })).toBeNull();
    expect(
      await p.verifyNotification({
        payload: { ...payload, signature: MockPaymentProvider.SIGNATURE },
      }),
    ).toEqual({
      orderId: 'INV-1',
      providerPaymentId: 'P9',
      amountCents: 250_000,
      currency: 'LKR',
      status: 'success',
    });
  });

  it('can simulate an outage', async () => {
    const p = new MockPaymentProvider();
    p.failNext(new Error('gateway down'));
    await expect(p.createCheckout(checkout)).rejects.toThrow('gateway down');
    await expect(p.createCheckout(checkout)).resolves.toBeDefined();
    p.reset();
    expect(p.calls).toHaveLength(0);
  });
});

describe('MockSmsProvider + smsSegments', () => {
  it('sends once per idempotency key', async () => {
    const sms = new MockSmsProvider();
    const input = {
      tenantId: T1,
      sender: { gateway: 'remix-wallet' as const, senderId: 'KamalPhys' },
      to: '+94771234567',
      text: 'Class moved to 4pm',
      idempotencyKey: 'n-1',
    };
    const a = await sms.send(input);
    expect(await sms.send(input)).toEqual(a);
    expect(sms.delivered).toBe(1);
    expect(a.segments).toBe(1);
  });

  it('counts GSM-7 and UCS-2 segments', () => {
    expect(smsSegments('a'.repeat(160))).toBe(1);
    expect(smsSegments('a'.repeat(161))).toBe(2);
    expect(smsSegments('ප'.repeat(70))).toBe(1);
    expect(smsSegments('ප'.repeat(71))).toBe(2);
  });
});

describe('storage', () => {
  it('prefixes object keys with the tenant and refuses traversal', () => {
    expect(tenantObjectKey(T1, 'slips/2026-10/a.jpg')).toBe(`${T1}/slips/2026-10/a.jpg`);
    for (const bad of ['../x', 'a/../../b', '/abs', 'a//b', 'a\\b', '', '.hidden']) {
      expect(() => tenantObjectKey(T1, bad), bad).toThrow(RangeError);
    }
    expect(() => tenantObjectKey('not-a-uuid', 'a')).toThrow(RangeError);
  });

  it('caps signed URL lifetimes at 10 minutes', () => {
    expect(() => {
      assertSignedUrlTtl(MAX_SIGNED_URL_TTL_SEC);
    }).not.toThrow();
    for (const bad of [0, 601, 1.5])
      expect(() => {
        assertSignedUrlTtl(bad);
      }).toThrow(RangeError);
  });

  it('issues tenant-prefixed, expiring URLs', async () => {
    const s = new MockStorageProvider(() => NOW);
    const up = await s.createUploadUrl({
      tenantId: T1,
      key: 'slips/a.jpg',
      contentType: 'image/jpeg',
      maxBytes: 5_000_000,
      expiresInSec: 300,
    });
    expect(up.objectKey).toBe(`${T1}/slips/a.jpg`);
    expect(up.expiresAt.getTime()).toBe(NOW + 300_000);
    await expect(
      s.createDownloadUrl({ tenantId: T1, key: 'slips/a.jpg', expiresInSec: 3600 }),
    ).rejects.toThrow(RangeError);
    s.put(T1, 'slips/a.jpg');
    await s.deleteObject({ tenantId: T1, key: 'slips/a.jpg' });
    expect(s.objects.size).toBe(0);
  });
});

describe('MockVideoProvider', () => {
  const library = { provider: 'bunny' as const, collectionId: 'c1' };

  it('scopes videos to their tenant and caps playback TTL at 2 h', async () => {
    const v = new MockVideoProvider(() => NOW);
    const { videoId } = await v.createUpload({
      tenantId: T1,
      library,
      title: 'Lesson 1',
      idempotencyKey: 'l1',
    });
    const play = await v.createPlaybackUrl({ tenantId: T1, library, videoId, expiresInSec: 7200 });
    expect(play.expiresAt.getTime()).toBe(NOW + 7_200_000);
    await expect(
      v.createPlaybackUrl({ tenantId: T2, library, videoId, expiresInSec: 60 }),
    ).rejects.toThrow();
    await expect(
      v.createPlaybackUrl({ tenantId: T1, library, videoId, expiresInSec: 7201 }),
    ).rejects.toThrow(RangeError);
  });
});

describe('MockMeetingProvider', () => {
  const connection = { provider: 'zoom' as const, connectionId: 'z1' };
  const schedule = {
    startAt: new Date(NOW),
    durationMinutes: 90,
    timezone: 'Asia/Colombo' as const,
    recurrence: { weekdays: [6], until: new Date(NOW + 90 * 86_400_000) },
  };

  it('creates idempotent meetings and per-student registrant links', async () => {
    const m = new MockMeetingProvider();
    const a = await m.createMeeting({
      tenantId: T1,
      connection,
      topic: 'Physics',
      schedule,
      idempotencyKey: 'm1',
    });
    expect(
      await m.createMeeting({
        tenantId: T1,
        connection,
        topic: 'Physics',
        schedule,
        idempotencyKey: 'm1',
      }),
    ).toBe(a);
    const reg = {
      tenantId: T1,
      connection,
      meetingId: a.meetingId,
      firstName: 'Sample',
      lastName: 'Student',
      email: 'student@example.invalid',
      idempotencyKey: 'r1',
    };
    const r1 = await m.addRegistrant(reg);
    expect(await m.addRegistrant(reg)).toEqual(r1);
    await expect(m.addRegistrant({ ...reg, tenantId: T2 })).rejects.toThrow();
  });

  it('validates schedules', async () => {
    const m = new MockMeetingProvider();
    await expect(
      m.createMeeting({
        tenantId: T1,
        connection,
        topic: 'x',
        schedule: { ...schedule, recurrence: { weekdays: [0], until: new Date(NOW) } },
        idempotencyKey: 'bad',
      }),
    ).rejects.toThrow(RangeError);
  });
});

describe('MockEmailProvider', () => {
  it('needs a recipient and is idempotent', async () => {
    const e = new MockEmailProvider();
    const input = {
      tenantId: null,
      to: ['owner@example.invalid'],
      subject: 's',
      text: 't',
      idempotencyKey: 'e1',
    };
    const a = await e.send(input);
    expect(await e.send(input)).toEqual(a);
    await expect(e.send({ ...input, to: [], idempotencyKey: 'e2' })).rejects.toThrow(RangeError);
  });
});
