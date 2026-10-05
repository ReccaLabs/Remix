import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { inject } from 'vitest';
import { schema, type Db } from '@remix/db';
import { loadConfig } from '../../src/config/config';
import { ProcessorRegistry } from '../../src/jobs/processor-registry';
import { PeopleHooks } from '../../src/modules/people/people-hooks';
import { createWorker } from '../../src/worker.module';
import { LogCapture } from '../fixtures/test-app';
import { Factory, ownerDb } from './support/db-app';

/** The worker process wiring of the `imports` queue (ADR 0012), against the real database. */
describe('worker: imports processor (STU-04)', () => {
  let db: Db;
  let f: Factory;

  beforeAll(() => {
    db = ownerDb();
    f = new Factory(db);
  });
  afterAll(async () => {
    await db.$client.end();
  });

  it('boots with the database, registers the processor and imports a job end to end', async () => {
    const logs = new LogCapture();
    const app = await createWorker({
      config: loadConfig(
        { NODE_ENV: 'test', LOG_LEVEL: 'info', DATABASE_URL: inject('dbUrls').app },
        { requireDatabase: true },
      ),
      logDestination: logs,
    });
    try {
      const registry = app.get(ProcessorRegistry);
      expect(registry.queues().sort()).toEqual(['fees', 'imports', 'receipts', 'sms']);

      const tenant = await f.tenant('active');
      const staff = await f.staff(tenant, ['owner']);
      const [queued] = await db
        .insert(schema.importJobs)
        .values({
          tenantId: tenant.id,
          createdBy: staff.id,
          options: { sendWelcomeSms: false },
          input: [{ displayName: 'Worker Student', phone: '0771999001' }],
        })
        .returning({ id: schema.importJobs.id });
      const importId = queued?.id ?? '';
      const process = registry.get('imports');
      await process?.({ tenantId: tenant.id, importId } as never, {
        queue: 'imports',
        jobId: `import-${tenant.id}-${importId}`,
        attempt: 1,
      });

      const [job] = await db
        .select()
        .from(schema.importJobs)
        .where(eq(schema.importJobs.id, importId));
      expect(job).toMatchObject({ status: 'done', created: 1, enrolled: 0, input: null });
      const made = await db
        .select()
        .from(schema.tenantUsers)
        .where(eq(schema.tenantUsers.tenantId, tenant.id));
      expect(made.map((u) => u.displayName)).toContain('Worker Student');
      // The worker has its own hooks: the welcome SMS is wired to the OTP service.
      expect(app.get(PeopleHooks)).toBeDefined();
    } finally {
      await app.close();
    }
  });
});
