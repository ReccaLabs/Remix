import { sql } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import { resolveTenantByHost } from '../src/resolve';
import { withTenant } from '../src/tenant';
import { connectAll, expectPgError, PERMISSION_DENIED, rows } from './support';
import { createWorld, type World } from './tables';

/** Constraints of halls (CLS-05), the class → hall link and the tenant settings columns (TEN-03). */
const db = connectAll();
let A: World;
let B: World;

beforeAll(async () => {
  [A, B] = await Promise.all([createWorld(db.owner, 'cls-a'), createWorld(db.owner, 'cls-b')]);
});

const PG_CHECK = '23514';
const PG_UNIQUE = '23505';
const PG_FK = '23503';
const PG_RESTRICT = '23001';

describe('CLS-05 halls', () => {
  it('names are unique per institute, ignoring case', async () => {
    const insert = (name: string) =>
      db.owner.execute(
        sql`insert into halls (tenant_id, name, capacity) values (${A.tenantId}, ${name}, 50)`,
      );
    await insert('Lecture Room');
    await expectPgError(insert('lecture room'), PG_UNIQUE, /halls_tenant_name_key/);
  });

  it('the same name may exist at another institute', async () => {
    // Every world has a "Hall A" (test/tables.ts).
    const [row] = await rows<{ n: number }>(
      db.owner,
      sql`select count(*)::int as n from halls where lower(name) = 'hall a' and tenant_id in (${A.tenantId}, ${B.tenantId})`,
    );
    expect(row?.n).toBe(2);
  });

  it('rejects an empty or over-long name and an out-of-range capacity', async () => {
    const insert = (name: string, capacity: number | null) =>
      db.owner.execute(
        sql`insert into halls (tenant_id, name, capacity) values (${A.tenantId}, ${name}, ${capacity})`,
      );
    await expectPgError(insert('', 10), PG_CHECK, /halls_name_length/);
    await expectPgError(insert('x'.repeat(61), 10), PG_CHECK, /halls_name_length/);
    await expectPgError(insert('Zero', 0), PG_CHECK, /halls_capacity_range/);
    await expectPgError(insert('Huge', 5001), PG_CHECK, /halls_capacity_range/);
    await insert('No capacity', null);
  });

  it('a hall that a class uses cannot be deleted (ON DELETE RESTRICT)', async () => {
    await expectPgError(
      db.owner.execute(sql`delete from halls where id = ${A.hallId}`),
      PG_RESTRICT,
      /classes_hall_fk/,
    );
    await expectPgError(
      withTenant(db.app, A.tenantId, (tx) =>
        tx.execute(sql`delete from halls where id = ${A.hallId}`),
      ),
      PG_RESTRICT,
      /classes_hall_fk/,
    );
  });

  it('a class cannot use the hall of another institute', async () => {
    await expectPgError(
      db.owner.execute(sql`update classes set hall_id = ${B.hallId} where id = ${A.classId}`),
      PG_FK,
      /classes_hall_fk/,
    );
  });
});

describe('TEN-03 tenant settings columns', () => {
  it('the app may change name, locale, colour, logo and favicon of its own tenant', async () => {
    await withTenant(db.app, A.tenantId, async (tx) => {
      const result = await tx.execute(sql`
        update tenants set name = 'Renamed Institute', default_locale = 'si',
          brand_color = '#0f766e', logo_url = 'https://cdn.example.test/logo.png',
          favicon_url = 'https://cdn.example.test/favicon.png'
        where id = ${A.tenantId}`);
      expect(result.rowCount).toBe(1);
    });
    const [row] = await rows<{ name: string; favicon_url: string }>(
      db.owner,
      sql`select name, favicon_url from tenants where id = ${A.tenantId}`,
    );
    expect(row).toEqual({
      name: 'Renamed Institute',
      favicon_url: 'https://cdn.example.test/favicon.png',
    });
  });

  it('the app cannot change another tenant, nor plan, status, slug or prefix', async () => {
    const other = await withTenant(db.app, A.tenantId, (tx) =>
      tx.execute(sql`update tenants set name = 'Hacked' where id = ${B.tenantId}`),
    );
    expect(other.rowCount).toBe(0);
    const forbidden = [
      sql`plan = 'tutor'`,
      sql`status = 'active'`,
      sql`slug = ${'x-' + A.tag}`,
      sql`student_no_prefix = 'ZZ'`,
      sql`timezone = 'Asia/Colombo'`,
    ];
    for (const set of forbidden) {
      await expectPgError(
        withTenant(db.app, A.tenantId, (tx) =>
          tx.execute(sql`update tenants set ${set} where id = ${A.tenantId}`),
        ),
        '42501',
        PERMISSION_DENIED,
      );
    }
  });

  it('exactly five columns are updatable by the app', async () => {
    const granted = await rows<{ column_name: string }>(
      db.owner,
      sql`select column_name from information_schema.column_privileges
          where table_name = 'tenants' and grantee = 'remix_app' and privilege_type = 'UPDATE'
          order by column_name`,
    );
    expect(granted.map((r) => r.column_name)).toEqual([
      'brand_color',
      'default_locale',
      'favicon_url',
      'logo_url',
      'name',
    ]);
  });

  it('the tenant id column itself is not updatable', async () => {
    await expectPgError(
      withTenant(db.app, A.tenantId, (tx) =>
        tx.execute(sql`update tenants set id = ${B.tenantId} where id = ${A.tenantId}`),
      ),
      '42501',
      PERMISSION_DENIED,
    );
  });

  it('colours and image URLs are checked by the database too', async () => {
    const update = (set: ReturnType<typeof sql>) =>
      withTenant(db.app, A.tenantId, (tx) =>
        tx.execute(sql`update tenants set ${set} where id = ${A.tenantId}`),
      );
    await expectPgError(update(sql`brand_color = 'red;}body{'`), PG_CHECK, /brand_color_format/);
    await expectPgError(
      update(sql`favicon_url = 'http://insecure.example.test/f.png'`),
      PG_CHECK,
      /favicon_url_https/,
    );
    await expectPgError(update(sql`logo_url = 'javascript:alert(1)'`), PG_CHECK, /logo_url_https/);
  });

  it('the resolver returns the favicon', async () => {
    const tenant = await resolveTenantByHost(db.app, `${A.slug}.remix.lk`, {
      baseDomains: ['remix.lk'],
    });
    expect(tenant?.faviconUrl).toBe('https://cdn.example.test/favicon.png');
    const bare = await resolveTenantByHost(db.app, `${B.slug}.remix.lk`, {
      baseDomains: ['remix.lk'],
    });
    expect(bare?.faviconUrl).toBeNull();
  });
});
