import { sql } from 'drizzle-orm';
import { eq } from 'drizzle-orm';
import { tenantPublicSchema } from '@remix/types';
import { beforeAll, describe, expect, it } from 'vitest';
import { resolveTenantByHost, type TenantCache } from '../src/resolve';
import { tenantDomains, tenants } from '../src/schema';
import { withTenant } from '../src/tenant';
import { connectAll, expectPgError, PERMISSION_DENIED, rows } from './support';
import { createWorld, type World } from './tables';

const db = connectAll();
const BASE = { baseDomains: ['remix.lk', 'localhost'] } as const;
const PUBLIC_FIELDS = Object.keys(tenantPublicSchema.shape).sort();

let A: World;
let S: World;
let unverifiedHost: string;

beforeAll(async () => {
  [A, S] = await Promise.all([createWorld(db.owner, 'ra'), createWorld(db.owner, 'rs')]);
  await db.owner.update(tenants).set({ status: 'suspended' }).where(eq(tenants.id, S.tenantId));
  unverifiedHost = `unverified-${A.tag}.example.test`;
  await db.owner.insert(tenantDomains).values({ tenantId: A.tenantId, host: unverifiedHost });
});

describe('resolveTenantByHost (TEN-01) as remix_app, without a tenant context', () => {
  it('resolves <slug>.<baseDomain> to the public tenant record', async () => {
    const tenant = await resolveTenantByHost(db.app, `${A.slug}.remix.lk`, BASE);
    expect(tenant).toMatchObject({
      id: A.tenantId,
      slug: A.slug,
      status: 'trial',
      plan: 'institute',
    });
    expect(Object.keys(tenant ?? {}).sort()).toEqual(PUBLIC_FIELDS);
  });

  it('normalises case, port and trailing dot; works for the dev base domain', async () => {
    for (const host of [`${A.slug.toUpperCase()}.REMIX.LK.`, `${A.slug}.localhost:3001`]) {
      expect((await resolveTenantByHost(db.app, host, BASE))?.id).toBe(A.tenantId);
    }
  });

  it('resolves a verified custom domain', async () => {
    expect((await resolveTenantByHost(db.app, A.domainHost, BASE))?.id).toBe(A.tenantId);
  });

  it('never resolves an unverified custom domain', async () => {
    expect(await resolveTenantByHost(db.app, unverifiedHost, BASE)).toBeNull();
  });

  it('returns null for unknown, reserved, nested, apex and malformed hosts', async () => {
    for (const host of [
      'nobody-here.remix.lk',
      'unknown.example.test',
      'admin.remix.lk',
      'www.remix.lk',
      `x.${A.slug}.remix.lk`,
      'remix.lk',
      'localhost:3001',
      '127.0.0.1',
      "kamal'; drop table tenants;--.remix.lk",
      '',
    ]) {
      expect(await resolveTenantByHost(db.app, host, BASE), host).toBeNull();
    }
  });

  it('a suspended tenant resolves, with its status', async () => {
    const tenant = await resolveTenantByHost(db.app, `${S.slug}.remix.lk`, BASE);
    expect(tenant).toMatchObject({ id: S.tenantId, status: 'suspended' });
  });

  it('the resolver functions return exactly the tenantPublicSchema fields', async () => {
    for (const fn of ['resolve_tenant_by_slug', 'resolve_tenant_by_domain']) {
      const [row] = await rows<{ result: string }>(
        db.owner,
        sql`select pg_catalog.pg_get_function_result(p.oid) as result
            from pg_catalog.pg_proc p where p.proname = ${fn}`,
      );
      expect(row?.result, fn).toBe(
        'TABLE(id uuid, slug text, name text, status text, plan text, default_locale text, timezone text, brand_color text, logo_url text, favicon_url text)',
      );
    }
  });

  it('the app still cannot read tenants directly: none without context, only its own with it', async () => {
    expect(await rows(db.app, sql`select * from public.tenants`)).toEqual([]);
    const own = await withTenant(db.app, A.tenantId, (tx) =>
      rows<{ id: string }>(tx, sql`select id::text from public.tenants`),
    );
    expect(own.map((r) => r.id)).toEqual([A.tenantId]);
  });

  it('only remix_app may execute the resolvers', async () => {
    for (const role of [db.readonly, db.platform]) {
      await expectPgError(
        role.execute(sql`select * from public.resolve_tenant_by_slug(${A.slug})`),
        '42501',
        PERMISSION_DENIED,
      );
    }
  });
});

describe('resolveTenantByHost cache port', () => {
  function memoryCache() {
    const store = new Map<string, { value: string; ttl: number }>();
    const cache: TenantCache = {
      get: async (key) => store.get(key)?.value ?? null,
      set: async (key, value, ttl) => {
        store.set(key, { value, ttl });
      },
    };
    return { store, cache };
  }

  it('caches positive results under host:<normalised host> for 60 s', async () => {
    const { store, cache } = memoryCache();
    await resolveTenantByHost(db.app, `${A.slug}.REMIX.lk:443`, { ...BASE, cache });
    const entry = store.get(`host:${A.slug}.remix.lk`);
    expect(entry?.ttl).toBe(60);
    expect(JSON.parse(entry?.value ?? 'null')).toMatchObject({ id: A.tenantId });

    await resolveTenantByHost(db.app, 'unknown.example.test', { ...BASE, cache });
    expect(store.size).toBe(1);
  });

  it('ignores a cache entry that is not a valid public tenant record', async () => {
    const { store, cache } = memoryCache();
    store.set(`host:${A.slug}.remix.lk`, { value: '{"id":"evil"}', ttl: 60 });
    const tenant = await resolveTenantByHost(db.app, `${A.slug}.remix.lk`, { ...BASE, cache });
    expect(tenant?.id).toBe(A.tenantId);
  });
});
