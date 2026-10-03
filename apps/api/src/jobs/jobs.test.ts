import { UnrecoverableError } from 'bullmq';
import type { Redis } from 'ioredis';
import { describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../config/config';
import { MockSmsProvider } from '../integrations/sms/sms.mock';
import { smsProviderBinding, UnconfiguredSmsProvider } from '../integrations/sms/sms-binding';
import { BullJobProducer, JobQueueUnavailableError, UnavailableJobProducer } from './job-producer';
import { JobWorkers } from './job-workers';
import { ProcessorRegistry } from './processor-registry';
import { createSmsProcessor } from './sms/sms.processor';
import { InlineJobProducer } from './testing/inline-jobs';

const TENANT = '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b';
const sms = (messageId = 'm1') => ({
  tenantId: TENANT,
  messageId,
  gateway: 'remix-wallet' as const,
  senderId: 'ReMix',
  to: '+94771234567',
  text: 'Your ReMix code is 123456',
});

describe('sms processor', () => {
  it('sends through the provider with a stable idempotency key', async () => {
    const provider = new MockSmsProvider();
    const process = createSmsProcessor(provider);
    const ctx = { queue: 'sms', jobId: 'j', attempt: 1 } as const;
    await process(sms(), ctx);
    await process(sms(), { ...ctx, attempt: 2 }); // a retry
    expect(provider.callsTo('send')).toHaveLength(2);
    expect(provider.delivered).toBe(1); // sent once: same idempotency key
    expect(provider.callsTo<{ idempotencyKey: string; sender: object }>('send')[0]).toMatchObject({
      idempotencyKey: `${TENANT}:m1`,
      sender: { gateway: 'remix-wallet', senderId: 'ReMix' },
    });
  });

  it('passes credentialsRef only when present and propagates provider errors', async () => {
    const provider = new MockSmsProvider();
    const process = createSmsProcessor(provider);
    const ctx = { queue: 'sms', jobId: 'j', attempt: 1 } as const;
    await process({ ...sms(), gateway: 'byo-http', credentialsRef: 'cred-1' }, ctx);
    expect(provider.callsTo<{ sender: object }>('send')[0]?.sender).toMatchObject({
      credentialsRef: 'cred-1',
    });
    provider.failNext(new Error('gateway down'));
    await expect(process(sms('m2'), ctx)).rejects.toThrow('gateway down');
  });
});

describe('SMS provider binding', () => {
  it('binds the logging mock in development', () => {
    const provider = smsProviderBinding(loadConfig({ NODE_ENV: 'development' }));
    expect(provider).toBeInstanceOf(MockSmsProvider);
  });

  it('the mock logs the full text when given a log sink (dev visibility of OTP codes)', async () => {
    const lines: string[] = [];
    const provider = new MockSmsProvider({ log: (l) => lines.push(l) });
    await provider.send({
      tenantId: TENANT,
      sender: { gateway: 'remix-wallet', senderId: 'ReMix' },
      to: '+94771234567',
      text: 'Your ReMix code is 654321',
      idempotencyKey: 'k',
    });
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('654321');
    expect(lines[0]).toContain('+94771234567');
  });

  it('never binds the mock in production: sending fails visibly instead', async () => {
    const config = loadConfig({
      NODE_ENV: 'production',
      TENANT_BASE_DOMAINS: 'remix.lk',
      TRUST_PROXY: '10.0.0.0/8',
      VALKEY_URL: 'redis://valkey:6379',
    });
    const provider = smsProviderBinding(config);
    expect(provider).toBeInstanceOf(UnconfiguredSmsProvider);
    expect(provider).not.toBeInstanceOf(MockSmsProvider);
    await expect(
      provider.send({
        tenantId: TENANT,
        sender: { gateway: 'remix-wallet', senderId: 'ReMix' },
        to: '+94771234567',
        text: 'x',
        idempotencyKey: 'k',
      }),
    ).rejects.toThrow('No SMS gateway adapter');
  });
});

describe('ProcessorRegistry', () => {
  it('registers one processor per queue', () => {
    const registry = new ProcessorRegistry();
    registry.register('sms', () => Promise.resolve());
    expect(registry.queues()).toEqual(['sms']);
    expect(registry.get('sms')).toBeTypeOf('function');
    expect(registry.get('imports')).toBeUndefined();
    expect(() => {
      registry.register('sms', () => Promise.resolve());
    }).toThrow('already registered');
  });
});

describe('producers', () => {
  it('UnavailableJobProducer fails with JobQueueUnavailableError', async () => {
    await expect(new UnavailableJobProducer().add()).rejects.toBeInstanceOf(
      JobQueueUnavailableError,
    );
  });

  it('JobsModule without VALKEY_URL: inline in development, refusing in test', async () => {
    const { Test } = await import('@nestjs/testing');
    const { JobsModule } = await import('./jobs.module');
    const { JOB_PRODUCER } = await import('./job-producer');
    const producerFor = async (nodeEnv: string) => {
      const ref = await Test.createTestingModule({
        imports: [JobsModule.forRoot(loadConfig({ NODE_ENV: nodeEnv }))],
      }).compile();
      return ref.get<{ add: InlineJobProducer['add'] }>(JOB_PRODUCER);
    };
    const dev = await producerFor('development');
    expect(dev).toBeInstanceOf(InlineJobProducer);
    await expect(dev.add('sms', sms('dev'))).resolves.toEqual({ jobId: `sms-${TENANT}-dev` });
    const test = await producerFor('test');
    await expect(test.add('sms', sms())).rejects.toBeInstanceOf(JobQueueUnavailableError);
   }, 30_000);

  it('BullJobProducer validates the payload before touching Valkey', async () => {
    const connection = new Proxy({} as Redis, {
      get() {
        throw new Error('Valkey must not be touched for an invalid payload');
      },
    });
    const producer = new BullJobProducer(connection);
    await expect(producer.add('sms', { ...sms(), to: 'nope' })).rejects.toThrow();
  });
});

describe('JobWorkers', () => {
  it('does nothing without processors, and warns (no crash) without VALKEY_URL', () => {
    const empty = new JobWorkers(loadConfig({}), new ProcessorRegistry());
    expect(() => {
      empty.onApplicationBootstrap();
    }).not.toThrow();

    const registry = new ProcessorRegistry();
    registry.register('sms', () => Promise.resolve());
    const noValkey = new JobWorkers(loadConfig({}), registry);
    expect(() => {
      noValkey.onApplicationBootstrap();
    }).not.toThrow();
    return expect(noValkey.onApplicationShutdown()).resolves.toBeUndefined();
  });
});

describe('InlineJobProducer (test helper)', () => {
  it('queues until drained and runs the processor', async () => {
    const provider = new MockSmsProvider();
    const jobs = new InlineJobProducer({ sms: createSmsProcessor(provider) });
    const { jobId } = await jobs.add('sms', sms());
    expect(jobId).toBe(`sms-${TENANT}-m1`);
    expect(provider.delivered).toBe(0);
    await jobs.drain();
    expect(provider.delivered).toBe(1);
    expect(jobs.of('sms')[0]).toMatchObject({ status: 'completed', attempts: 1 });
  });

  it('ignores duplicates and validates payloads like the real producer', async () => {
    const jobs = new InlineJobProducer({ sms: () => Promise.resolve() });
    await jobs.add('sms', sms());
    await jobs.add('sms', sms());
    expect(jobs.jobs).toHaveLength(1);
    await expect(jobs.add('sms', { ...sms(), text: '' })).rejects.toThrow();
  });

  it('retries up to 5 attempts, stops on UnrecoverableError, and can autoRun', async () => {
    const flaky = vi.fn().mockRejectedValueOnce(new Error('boom')).mockResolvedValue(undefined);
    const jobs = new InlineJobProducer({ sms: flaky }, { autoRun: true });
    await jobs.add('sms', sms('a'));
    expect(jobs.of('sms')[0]).toMatchObject({ status: 'completed', attempts: 2 });

    const dead = new InlineJobProducer({ sms: () => Promise.reject(new Error('always')) });
    await dead.add('sms', sms('b'));
    await dead.drain();
    expect(dead.of('sms')[0]).toMatchObject({ status: 'failed', attempts: 5 });

    const fatal = new InlineJobProducer({
      sms: () => Promise.reject(new UnrecoverableError('invalid number')),
    });
    await fatal.add('sms', sms('c'));
    await fatal.drain();
    expect(fatal.of('sms')[0]).toMatchObject({ status: 'failed', attempts: 1 });
  });

  it('fails loudly when a queue has no processor', async () => {
    const jobs = new InlineJobProducer({});
    await jobs.add('sms', sms());
    await expect(jobs.drain()).rejects.toThrow('No processor registered');
  });
});
