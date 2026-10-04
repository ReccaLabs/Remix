import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withTenant } from '../src/tenant';
import {
  connectAll,
  count,
  expectPgError,
  PERMISSION_DENIED,
  RLS_VIOLATION,
  Rollback,
  rolledBack,
  rows,
} from './support';
import {
  createWorld,
  deleteRow,
  insertRow,
  moveRow,
  selectTenantIds,
  spec,
  TABLE_NAMES,
  touchRow,
  whereKey,
  type World,
} from './tables';

/**
 * Generated cross-tenant suite (ADR 0005, 04-quality §4.1): for every table in the factory map,
 * tenant A's context (as remix_app) can neither see nor change tenant B's rows. The catalog test
 * guarantees every table in `public` is in the map.
 */
const db = connectAll();
let A: World;
let B: World;

beforeAll(async () => {
  [A, B] = await Promise.all([createWorld(db.owner, 'a'), createWorld(db.owner, 'b')]);
});

describe.each(TABLE_NAMES)('%s', (name) => {
  const t = spec(name);
  const writable = t.access === 'full' || t.access === 'append' || t.access === 'projection';
  const table = sql.identifier(name);

  it("in tenant A's context, every visible row belongs to A", async () => {
    const seen = await withTenant(db.app, A.tenantId, (tx) =>
      rows<{ tenant: string }>(tx, selectTenantIds(name, t.tenantColumn)),
    );
    expect(seen.length).toBeGreaterThan(0);
    expect(new Set(seen.map((r) => r.tenant))).toEqual(new Set([A.tenantId]));
  });

  it("B's row is invisible from A, even when addressed by its key", async () => {
    const found = await withTenant(db.app, A.tenantId, (tx) =>
      rows(tx, sql`select 1 from ${table} where ${whereKey(t.key(B))}`),
    );
    expect(found).toEqual([]);
  });

  it('without a tenant context the table reads empty (app and readonly roles)', async () => {
    expect(await withTenant(db.owner, A.tenantId, (tx) => count(tx, name))).toBeGreaterThan(0);
    expect(await count(db.app, name)).toBe(0);
    expect(await count(db.readonly, name)).toBe(0);
  });

  it('remix_readonly is bound by RLS the same way', async () => {
    const seen = await withTenant(db.readonly, B.tenantId, (tx) =>
      rows<{ tenant: string }>(tx, selectTenantIds(name, t.tenantColumn)),
    );
    expect(new Set(seen.map((r) => r.tenant))).toEqual(new Set([B.tenantId]));
  });

  it("inserting a row for tenant B from A's context is rejected", async () => {
    await expectPgError(
      withTenant(db.app, A.tenantId, (tx) => tx.execute(insertRow(name, t.fresh(B)))),
      '42501',
      writable ? RLS_VIOLATION : PERMISSION_DENIED,
    );
  });

  if (writable && !t.singleton) {
    it('control: the same kind of row for A itself is accepted (rolled back)', async () => {
      await rolledBack(
        withTenant(db.app, A.tenantId, async (tx) => {
          await tx.execute(insertRow(name, t.fresh(A)));
          throw new Rollback();
        }),
      );
    });
  }

  if (t.access === 'full') {
    it("updating B's row from A affects 0 rows (control: A's row updates)", async () => {
      const other = await withTenant(db.app, A.tenantId, (tx) =>
        tx.execute(touchRow(name, t.tenantColumn, t.key(B))),
      );
      expect(other.rowCount).toBe(0);
      await rolledBack(
        withTenant(db.app, A.tenantId, async (tx) => {
          const own = await tx.execute(touchRow(name, t.tenantColumn, t.key(A)));
          expect(own.rowCount).toBe(1);
          throw new Rollback();
        }),
      );
    });

    it("moving A's row into tenant B is rejected by WITH CHECK", async () => {
      await expectPgError(
        withTenant(db.app, A.tenantId, (tx) =>
          tx.execute(moveRow(name, t.tenantColumn, t.key(A), B.tenantId)),
        ),
        '42501',
        RLS_VIOLATION,
      );
    });

    it("deleting B's row from A affects 0 rows", async () => {
      const result = await withTenant(db.app, A.tenantId, (tx) =>
        tx.execute(deleteRow(name, t.key(B))),
      );
      expect(result.rowCount).toBe(0);
    });
  } else {
    it('UPDATE and DELETE are not granted at all', async () => {
      await expectPgError(
        withTenant(db.app, A.tenantId, (tx) =>
          tx.execute(touchRow(name, t.tenantColumn, t.key(A))),
        ),
        '42501',
        PERMISSION_DENIED,
      );
      await expectPgError(
        withTenant(db.app, A.tenantId, (tx) => tx.execute(deleteRow(name, t.key(A)))),
        '42501',
        PERMISSION_DENIED,
      );
    });
  }

  it('TRUNCATE is denied (it would ignore RLS)', async () => {
    await expectPgError(
      withTenant(db.app, A.tenantId, (tx) => tx.execute(sql`truncate ${table} cascade`)),
      '42501',
      PERMISSION_DENIED,
    );
  });

  for (const [ref, build] of Object.entries(t.crossTenantRefs ?? {})) {
    it(`composite FK rejects ${ref} pointing at tenant B (as owner and as app in A)`, async () => {
      await expectPgError(withTenant(db.owner, A.tenantId, (tx) => tx.execute(insertRow(name, build(A, B)))), '23503');
      await expectPgError(
        withTenant(db.app, A.tenantId, (tx) => tx.execute(insertRow(name, build(A, B)))),
        '23503',
      );
    });
  }
});

afterAll(async () => {
  // Nothing above may have changed tenant B: each of its rows is still there.
  for (const name of TABLE_NAMES) {
    const t = spec(name);
    const found = await withTenant(db.owner, B.tenantId, (tx) => rows(
      tx, sql`select 1 from ${sql.identifier(name)} where ${whereKey(t.key(B))}`,
    ));
    expect(found, `${name}: tenant B's row`).toHaveLength(1);
  }
});
