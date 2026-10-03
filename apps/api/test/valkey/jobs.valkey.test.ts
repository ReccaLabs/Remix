import { Test } from '@nestjs/testing';
import { Queue } from 'bullmq';
import type { Redis } from 'ioredis';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createValkeyClient, ValkeyModule } from '../../src/common/valkey/valkey';
import { loadConfig } from '../../src/config/config';
import { HealthModule } from '../../src/health/health.module';
import { ReadinessRegistry } from '../../src/health/readiness';
import { MockSmsProvider } from '../../src/integrations/sms/sms.mock';
import { BullJobProducer, JobQueueUnavailableError } from '../../src/jobs/job-producer';
import { JobWorkers } from '../../src/jobs/job-workers';
import { ProcessorRegistry } from '../../src/jobs/processor-registry';
import { createSmsProcessor } from '../../src/jobs/sms/sms.processor';
import { deleteByPrefix, reachable, uniqueName, VALKEY_URL } from './support';

const TENANT = '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b';
const sms = (messageId: string, text = 'Your ReMix code is 123456') => ({
  tenantId: TENANT,
  messageId,
  gateway: 'remix-wallet' as const,
  senderId: 'ReMix',
  to: '+94771234567',
  text,
});

async function until(check: () => boolean | Promise<boolean>, ms = 15_000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error('condition not met in time');
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

describe.skipIf(!reachable)('jobs on real Valkey', () => {
  const prefix = uniqueName('jobs');
  const config = loadConfig({ NODE_ENV: 'test', VALKEY_URL });
  let client: Redis;
  let producer: BullJobProducer;
  let provider: MockSmsProvider;
  let workers: JobWorkers | undefined;

  function startWorker(): void {
    provider = new MockSmsProvider();
    const registry = new ProcessorRegistry();
    registry.register('sms', createSmsProcessor(provider));
    workers = new JobWorkers(config, registry, { prefix });
    workers.onApplicationBootstrap();
  }

  beforeAll(() => {
    client = createValkeyClient(VALKEY_URL);
    producer = new BullJobProducer(client, prefix);
  });

  afterEach(async () => {
    await workers?.onApplicationShutdown();
    workers = undefined;
  });

  afterAll(async () => {
    await producer.onApplicationShutdown();
    await deleteByPrefix(client, prefix);
    client.disconnect();
  });

  it('runs a job end to end through the sms processor, once, with the business key', async () => {
    startWorker();
    const { jobId } = await producer.add('sms', sms('m-1'));
    expect(jobId).toBe(`sms-${TENANT}-m-1`);
    await until(() => provider.delivered === 1);
    expect(provider.callsTo<{ idempotencyKey: string; to: string }>('send')[0]).toMatchObject({
      idempotencyKey: `${TENANT}:m-1`,
      to: '+94771234567',
    });
  });

  it('ignores a second add with the same business key', async () => {
    await producer.add('sms', sms('m-dup'));
    await producer.add('sms', sms('m-dup'));
    startWorker();
    await until(() => provider.delivered === 1);
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(provider.callsTo('send')).toHaveLength(1);
  });

  it('rejects an invalid payload before it reaches Valkey', async () => {
    await expect(producer.add('sms', { ...sms('m-bad'), to: '+94112345678' })).rejects.toThrow();
    await expect(
      producer.add('sms', { ...sms('m-extra'), password: 'x' } as unknown as ReturnType<
        typeof sms
      >),
    ).rejects.toThrow();
  });

  it('retries a failing job with backoff, then succeeds', async () => {
    startWorker();
    provider.failNext(new Error('gateway timeout'));
    await producer.add('sms', sms('m-retry'));
    // First attempt fails at once; the retry comes after the 5 s backoff.
    await until(() => provider.delivered === 1, 20_000);
    expect(provider.callsTo('send')).toHaveLength(2);
  }, 30_000);

  it('moves a malformed job (written behind the producer) to the failed set without retrying', async () => {
    startWorker();
    const raw = new Queue('sms', { connection: client, prefix });
    await raw.add('sms', { tenantId: 'not-a-uuid' }, { jobId: 'raw-bad', attempts: 5 });
    await until(async () => (await raw.getFailedCount()) === 1);
    const job = await raw.getJob('raw-bad');
    expect(job?.attemptsMade).toBe(1);
    expect(provider.callsTo('send')).toHaveLength(0);
    await raw.close();
  });

  it('shuts down gracefully, finishing the running job first', async () => {
    provider = new MockSmsProvider();
    const registry = new ProcessorRegistry();
    let started = false;
    registry.register('sms', async (payload, ctx) => {
      started = true;
      await new Promise((resolve) => setTimeout(resolve, 500));
      await createSmsProcessor(provider)(payload, ctx);
    });
    workers = new JobWorkers(config, registry, { prefix });
    workers.onApplicationBootstrap();
    await producer.add('sms', sms('m-drain'));
    await until(() => started);
    await workers.onApplicationShutdown();
    workers = undefined;
    expect(provider.delivered).toBe(1);
  });

  it('fails fast with JobQueueUnavailableError when Valkey is unreachable', async () => {
    const dead = createValkeyClient(VALKEY_URL);
    await new Promise((resolve) => dead.once('ready', resolve));
    dead.disconnect();
    const deadProducer = new BullJobProducer(dead, prefix);
    await expect(deadProducer.add('sms', sms('m-down'))).rejects.toBeInstanceOf(
      JobQueueUnavailableError,
    );
  });

  it('reports the valkey readiness check through the health registry', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [HealthModule, ValkeyModule.forRoot(config)],
    }).compile();
    const app = moduleRef.createNestApplication();
    await app.init();
    const report = await app.get(ReadinessRegistry).run();
    expect(report).toEqual({ ready: true, checks: { valkey: 'ok' } });
    await app.close();
  });
});
