import { sql } from 'drizzle-orm';
import { beforeAll, describe, expect, inject, it } from 'vitest';
import { createDb, verifyAppRole } from '../src/client';
import { advanceCounter, allocateNumbers } from '../src/counters';
import { classes } from '../src/schema';
import { withTenant } from '../src/tenant';
import { connectAll, expectPgError, RLS_VIOLATION, Rollback, rolledBack, rows } from './support';
import { createWorld, type World } from './tables';

const db = connectAll();
let A: World;
let B: World;

beforeAll(async () => {
  [A, B] = await Promise.all([createWorld(db.owner, 'wa'), createWorld(db.owner, 'wb')]);
});

const currentTenant = sql`select pg_catalog.current_setting('app.tenant_id', true) as value, public.app_tenant_id()::text as tenant`;

describe('withTenant', () => {
  it('rejects a non-UUID tenant id before touching the database', async () => {
    for (const bad of [
      '',
      'kamalphysics',
      "1' or '1'='1",
      `${A.tenantId} `,
      '00000000-0000-0000-0000',
    ]) {
      await expect(withTenant(db.app, bad, async () => 'ran')).rejects.toThrow(TypeError);
    }
  });

  it('scopes queries to the tenant through the typed query builder', async () => {
    const rowsA = await withTenant(db.app, A.tenantId, (tx) =>
      tx.select({ id: classes.id, tenantId: classes.tenantId }).from(classes),
    );
    expect(rowsA).toEqual([{ id: A.classId, tenantId: A.tenantId }]);
  });

  it('does not leak the setting to the next transaction on the same pooled connection', async () => {
    const single = createDb(inject('dbUrls').app, { max: 1 });
    try {
      const inside = await withTenant(single, A.tenantId, (tx) =>
        rows<{ value: string; tenant: string | null }>(tx, currentTenant),
      );
      expect(inside[0]?.tenant).toBe(A.tenantId);

      const pid = await rows<{ pid: number }>(single, sql`select pg_backend_pid() as pid`);
      const after = await rows<{ value: string | null; tenant: string | null; pid: number }>(
        single,
        sql`select pg_catalog.current_setting('app.tenant_id', true) as value,
          public.app_tenant_id()::text as tenant, pg_backend_pid() as pid`,
      );
      expect(after[0]?.pid).toBe(pid[0]?.pid);
      expect(after[0]?.tenant).toBeNull();
      expect(await rows(single, sql`select 1 from public.classes`)).toEqual([]);

      // Same after a failed transaction.
      await expect(
        withTenant(single, A.tenantId, async () => {
          throw new Error('boom');
        }),
      ).rejects.toThrow('boom');
      const afterError = await rows<{ tenant: string | null }>(single, currentTenant);
      expect(afterError[0]?.tenant).toBeNull();
    } finally {
      await single.$client.end();
    }
  });

  it('refuses to nest a different tenant, allows the same tenant', async () => {
    await expect(
      withTenant(db.app, A.tenantId, () => withTenant(db.app, B.tenantId, async () => 'nested')),
    ).rejects.toThrow(/different tenant/);
    await expect(
      withTenant(db.app, A.tenantId, (tx) => withTenant(tx, A.tenantId, async () => 'ok')),
    ).resolves.toBe('ok');
  });

  it('a malformed app.tenant_id fails closed with an error, not with rows', async () => {
    await expectPgError(
      db.app.transaction(async (tx) => {
        await tx.execute(sql`select pg_catalog.set_config('app.tenant_id', 'not-a-uuid', true)`);
        await tx.execute(sql`select * from public.classes`);
      }),
      '22P02',
    );
  });
});

describe('verifyAppRole', () => {
  it('accepts remix_app and rejects the owner and the superuser', async () => {
    await expect(verifyAppRole(db.app)).resolves.toBeUndefined();
    await expect(verifyAppRole(db.owner)).rejects.toThrow(/not RLS-bound/);
    await expect(verifyAppRole(db.superuser)).rejects.toThrow(/not RLS-bound/);
  });
});

describe('allocateNumbers (tenant_counters, ADR 0007)', () => {
  it('restarts the student sequence independently each year', async () => {
    const allocate = (year: string) =>
      withTenant(db.app, A.tenantId, (tx) => allocateNumbers(tx, 'student', 1, year));
    expect(await allocate('2026')).toEqual({ first: 1, last: 1 });
    expect(await allocate('2026')).toEqual({ first: 2, last: 2 });
    expect(await allocate('2027')).toEqual({ first: 1, last: 1 });
  });
  it('allocates consecutive blocks per tenant and kind', async () => {
    // createWorld seeded A's 'student' counter at 1.
    const first = await withTenant(db.app, A.tenantId, (tx) => allocateNumbers(tx, 'student'));
    const block = await withTenant(db.app, A.tenantId, (tx) => allocateNumbers(tx, 'student', 50));
    expect(first).toEqual({ first: 2, last: 2 });
    expect(block).toEqual({ first: 3, last: 52 });

    const receipt = await withTenant(db.app, A.tenantId, (tx) =>
      allocateNumbers(tx, 'receipt', 1, '2026'),
    );
    expect(receipt).toEqual({ first: 1, last: 1 });
    const otherTenant = await withTenant(db.app, B.tenantId, (tx) =>
      allocateNumbers(tx, 'student'),
    );
    expect(otherTenant).toEqual({ first: 2, last: 2 });
  });

  it('is gap-free: a rolled-back allocation gives its numbers back', async () => {
    const before = await withTenant(db.app, B.tenantId, (tx) =>
      allocateNumbers(tx, 'receipt', 1, '2027'),
    );
    await rolledBack(
      withTenant(db.app, B.tenantId, async (tx) => {
        await allocateNumbers(tx, 'receipt', 5, '2027');
        throw new Rollback();
      }),
    );
    const after = await withTenant(db.app, B.tenantId, (tx) =>
      allocateNumbers(tx, 'receipt', 1, '2027'),
    );
    expect(after.first).toBe(before.last + 1);
  });

  it('fails outside a tenant context and rejects bad counts', async () => {
    await expect(db.app.transaction((tx) => allocateNumbers(tx, 'student'))).rejects.toThrow();
    await expect(
      withTenant(db.app, A.tenantId, (tx) => allocateNumbers(tx, 'student', 0)),
    ).rejects.toThrow(RangeError);
  });

  it('serializes reservations with concurrent allocation and never lowers the counter', async () => {
    const blocks = await Promise.all(
      Array.from({ length: 8 }, (_, i) =>
        withTenant(db.app, A.tenantId, async (tx) => {
          await advanceCounter(tx, 'receipt', 100 + i, 'reservation');
          return allocateNumbers(tx, 'receipt', 1, 'reservation');
        }),
      ),
    );
    expect(new Set(blocks.map((b) => b.first)).size).toBe(8);
    const highest = Math.max(...blocks.map((b) => b.last));
    await withTenant(db.app, A.tenantId, (tx) => advanceCounter(tx, 'receipt', 0, 'reservation'));
    expect(
      await withTenant(db.app, A.tenantId, (tx) =>
        allocateNumbers(tx, 'receipt', 1, 'reservation'),
      ),
    ).toEqual({ first: highest + 1, last: highest + 1 });
    expect(
      await withTenant(db.app, B.tenantId, (tx) =>
        allocateNumbers(tx, 'receipt', 1, 'reservation'),
      ),
    ).toEqual({ first: 1, last: 1 });
    await expect(db.app.transaction((tx) => advanceCounter(tx, 'student', 100))).rejects.toThrow();
  });

  it("cannot bump another tenant's counter", async () => {
    await expectPgError(
      withTenant(db.app, A.tenantId, (tx) =>
        tx.execute(sql`
          insert into public.tenant_counters (tenant_id, kind, period, value)
          values (${B.tenantId}, 'student', '', 1)
          on conflict (tenant_id, kind, period) do update set value = tenant_counters.value + 1
        `),
      ),
      '42501',
      RLS_VIOLATION,
    );
  });
});
