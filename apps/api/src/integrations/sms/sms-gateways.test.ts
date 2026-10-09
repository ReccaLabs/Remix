import { describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../../config/config';
import { FailoverSmsProvider } from './failover-sms.provider';
import { NotifyLkSmsProvider } from './notify-lk.provider';
import { SmsRejectedError, SmsTransportError } from './sms-errors';
import { maskPhone, PLATFORM_SENDER_ID } from './sms-http';
import { smsProviderBinding, UnconfiguredSmsProvider } from './sms-binding';
import { MockSmsProvider } from './sms.mock';
import type { SendSmsInput, SmsProvider } from './sms.provider';
import { TextLkSmsProvider } from './text-lk.provider';

const TENANT = '0190aaaa-0000-7000-8000-000000000001';
const input = (over: Partial<SendSmsInput> = {}): SendSmsInput => ({
  tenantId: TENANT,
  sender: { gateway: 'remix-wallet', senderId: PLATFORM_SENDER_ID },
  to: '+94771234567',
  text: 'Fee receipt R-1',
  idempotencyKey: `${TENANT}:m1`,
  ...over,
});

function reply(status: number, body: unknown): typeof fetch {
  return vi.fn(() =>
    Promise.resolve(new Response(typeof body === 'string' ? body : JSON.stringify(body), { status })),
  );
}
const bodyOf = (call: unknown): string => (call as [string, RequestInit])[1].body as string;

describe('NotifyLkSmsProvider', () => {
  const make = (f: typeof fetch) =>
    new NotifyLkSmsProvider({ userId: 'u1', apiKey: 'k-secret', senderId: 'ReMixLK', timeoutMs: 50, fetch: f });

  it('posts a form with the 94 number and the platform sender, credentials not in the URL', async () => {
    const f = reply(200, { status: 'success', data: 'Sent' });
    const result = await make(f).send(input());
    expect(result.segments).toBe(1);
    expect(result.providerMessageId).toMatch(/^notifylk-/);
    const [url, init] = vi.mocked(f).mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://app.notify.lk/api/v1/send');
    expect(url).not.toContain('k-secret');
    const form = new URLSearchParams(init.body as string);
    expect(form.get('to')).toBe('94771234567');
    expect(form.get('sender_id')).toBe('ReMixLK');
    expect(form.get('type')).toBeNull();
  });

  it('uses a tenant sender id and unicode type for Sinhala text', async () => {
    const f = reply(200, { status: 'success', data: 'Sent' });
    const result = await make(f).send(input({ sender: { gateway: 'remix-wallet', senderId: 'KamalPhys' }, text: 'ගාස්තුව' }));
    const form = new URLSearchParams(bodyOf(vi.mocked(f).mock.calls[0]));
    expect(form.get('sender_id')).toBe('KamalPhys');
    expect(form.get('type')).toBe('unicode');
    expect(result.segments).toBe(1);
  });

  it('treats a number complaint and plain 4xx as a permanent rejection', async () => {
    await expect(make(reply(200, { status: 'error', data: 'Invalid number' })).send(input())).rejects.toBeInstanceOf(SmsRejectedError);
    await expect(make(reply(400, { status: 'error', data: 'bad' })).send(input())).rejects.toBeInstanceOf(SmsRejectedError);
  });

  it('treats 5xx, auth, rate limit and unknown bodies as transport errors', async () => {
    for (const f of [reply(503, ''), reply(401, {}), reply(429, {}), reply(200, { status: 'error', data: 'Insufficient credit' })]) {
      await expect(make(f).send(input())).rejects.toBeInstanceOf(SmsTransportError);
    }
  });

  it('times out as a transport error without leaking the key', async () => {
    const hang = ((_: string, init: RequestInit) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => { reject(new Error('aborted')); });
      })) as unknown as typeof fetch;
    const error = (await make(hang).send(input()).catch((e: unknown) => e)) as Error;
    expect(error).toBeInstanceOf(SmsTransportError);
    expect(error.message).toContain('timeout');
    expect(error.message).not.toContain('k-secret');
  });
});

describe('TextLkSmsProvider', () => {
  const make = (f: typeof fetch) => new TextLkSmsProvider({ apiToken: 'tok-secret', senderId: 'ReMixLK', timeoutMs: 50, fetch: f });

  it('sends bearer JSON and returns the gateway uid and segment count', async () => {
    const f = reply(200, { status: 'success', data: { uid: 'abc123', sms_count: 2 } });
    const result = await make(f).send(input());
    expect(result).toEqual({ providerMessageId: 'abc123', segments: 2 });
    const [url, init] = vi.mocked(f).mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://app.text.lk/api/v3/sms/send');
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer tok-secret');
    expect(JSON.parse(init.body as string)).toMatchObject({ recipient: '94771234567', sender_id: 'ReMixLK', type: 'plain' });
  });

  it('classifies errors', async () => {
    await expect(make(reply(422, { status: 'error', message: 'The recipient is invalid' })).send(input())).rejects.toBeInstanceOf(SmsRejectedError);
    await expect(make(reply(500, '')).send(input())).rejects.toBeInstanceOf(SmsTransportError);
    await expect(make(reply(401, { status: 'error' })).send(input())).rejects.toBeInstanceOf(SmsTransportError);
  });
});

describe('FailoverSmsProvider', () => {
  const ok: SmsProvider = { send: vi.fn(() => Promise.resolve({ providerMessageId: 'fb', segments: 1 })) };
  const failing = (error: Error): SmsProvider => ({ send: vi.fn(() => Promise.reject(error)) });

  it('falls back on transport errors only', async () => {
    const primary = failing(new SmsTransportError('notify.lk', 'HTTP 503'));
    expect(await new FailoverSmsProvider(primary, ok).send(input())).toMatchObject({ providerMessageId: 'fb' });
  });

  it('never falls back on a rejected number', async () => {
    const fallbackSend = vi.fn();
    const fallback: SmsProvider = { send: fallbackSend };
    const primary = failing(new SmsRejectedError('notify.lk', 'invalid number'));
    await expect(new FailoverSmsProvider(primary, fallback).send(input())).rejects.toBeInstanceOf(SmsRejectedError);
    expect(fallbackSend).not.toHaveBeenCalled();
  });

  it('surfaces the fallback error when both fail', async () => {
    const both = new FailoverSmsProvider(failing(new SmsTransportError('a', 'x')), failing(new SmsTransportError('b', 'y')));
    await expect(both.send(input())).rejects.toThrow(/b unavailable/);
  });
});

describe('binding and masking', () => {
  const prod = { NODE_ENV: 'production', TENANT_BASE_DOMAINS: 'remix.lk', TRUST_PROXY: '10.0.0.0/8', VALKEY_URL: 'redis://v:6379', INTEGRATIONS_KEY: Buffer.alloc(32, 1).toString('base64') };

  it('production without credentials is Unconfigured, never the mock', () => {
    expect(smsProviderBinding(loadConfig(prod))).toBeInstanceOf(UnconfiguredSmsProvider);
  });
  it('uses real gateways when configured, mock in dev otherwise', () => {
    const cfg = loadConfig({ ...prod, NOTIFYLK_USER_ID: 'u', NOTIFYLK_API_KEY: 'k', NOTIFYLK_SENDER_ID: 'ReMixLK', TEXTLK_API_TOKEN: 't', TEXTLK_SENDER_ID: 'ReMixLK', SMS_FALLBACK: 'textlk' });
    expect(smsProviderBinding(cfg)).toBeInstanceOf(FailoverSmsProvider);
    expect(smsProviderBinding(loadConfig({}))).toBeInstanceOf(MockSmsProvider);
  });
  it('rejects fallback equal to primary', () => {
    expect(() => loadConfig({ SMS_PRIMARY: 'textlk', SMS_FALLBACK: 'textlk' })).toThrow(/SMS_FALLBACK/);
  });
  it('masks phone numbers', () => {
    expect(maskPhone('+94771234567')).toBe('+94*****567');
  });
});
