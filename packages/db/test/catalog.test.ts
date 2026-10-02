import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import {
  foreignKeyViolations,
  grantViolations,
  indexViolations,
  policyViolations,
  publicAndFunctionViolations,
  roleViolations,
  tableViolations,
} from './catalog';
import { connectAll, Rollback, rolledBack } from './support';
import { TABLE_NAMES, TABLES } from './tables';

const db = connectAll();
const access = Object.fromEntries(TABLE_NAMES.map((name) => [name, TABLES[name].access]));

describe('catalog: every table is tenant-isolated (ADR 0005)', () => {
  it('every table in public has RLS, a policy, tenant_id, a tenant key, a trigger and a factory', async () => {
    expect(await tableViolations(db.owner, TABLE_NAMES)).toEqual([]);
  });

  it('every policy targets only remix_app/remix_readonly and compares with app_tenant_id()', async () => {
    expect(await policyViolations(db.owner)).toEqual([]);
  });

  it('every foreign key between tenant tables is composite on tenant_id', async () => {
    expect(await foreignKeyViolations(db.owner)).toEqual([]);
  });

  it('indexes on tenant tables lead with tenant_id (global uniques are allow-listed)', async () => {
    expect(await indexViolations(db.owner)).toEqual([]);
  });

  it('table privileges match the access matrix exactly — no TRUNCATE, REFERENCES or TRIGGER', async () => {
    expect(await grantViolations(db.owner, access)).toEqual([]);
  });

  it('no ReMix role bypasses RLS; app roles own nothing and are not members of the owner', async () => {
    expect(await roleViolations(db.owner)).toEqual([]);
  });

  it('PUBLIC has no privileges; SECURITY DEFINER functions are allow-listed and pinned', async () => {
    expect(await publicAndFunctionViolations(db.owner)).toEqual([]);
  });
});

describe('catalog checks catch mistakes (self-test, rolled back)', () => {
  it('a new table without RLS, policy, tenant key or factory entry is reported', async () => {
    await rolledBack(
      db.owner.transaction(async (tx) => {
        await tx.execute(sql`
          create table public.rls_canary (
            id uuid primary key default uuidv7(),
            tenant_id uuid not null references public.tenants (id),
            class_id uuid references public.classes (id),
            updated_at timestamptz not null default now()
          )
        `);
        const problems = [
          ...(await tableViolations(tx, TABLE_NAMES)),
          ...(await foreignKeyViolations(tx)),
        ];
        expect(problems).toEqual(
          expect.arrayContaining([
            'rls_canary: row level security is not enabled',
            'rls_canary: has no RLS policy',
            'rls_canary: needs unique (tenant_id, <primary key>) for composite foreign keys',
            'rls_canary: has updated_at but no set_updated_at trigger',
            'rls_canary: missing from the isolation factory map (test/tables.ts)',
            expect.stringMatching(
              /^rls_canary\.rls_canary_class_id_fkey: .* must include tenant_id/,
            ),
          ]),
        );
        throw new Rollback();
      }),
    );
  });

  it('a policy that does not compare with app_tenant_id() is reported', async () => {
    await rolledBack(
      db.owner.transaction(async (tx) => {
        await tx.execute(
          sql`create policy leaky on public.classes for select to remix_app using (true)`,
        );
        expect(await policyViolations(tx)).toEqual([
          'classes.leaky: USING (true) does not compare with app_tenant_id()',
        ]);
        throw new Rollback();
      }),
    );
  });

  it('a TRUNCATE grant to remix_app is reported', async () => {
    await rolledBack(
      db.owner.transaction(async (tx) => {
        await tx.execute(sql`grant truncate on public.sessions to remix_app`);
        expect(await grantViolations(tx, access)).toEqual([
          'sessions: remix_app has TRUNCATE (TRUNCATE ignores RLS)',
        ]);
        throw new Rollback();
      }),
    );
  });
});
