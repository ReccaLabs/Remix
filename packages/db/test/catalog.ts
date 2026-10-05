import { sql } from 'drizzle-orm';
import type { Queryable } from '../src/client';
import { rows } from './support';
import { APP_PRIVILEGES, type Access } from './tables';

/**
 * Static checks over the Postgres catalog (ADR 0005 "Proving it"). Each function returns a list
 * of human-readable violations; the tests assert the lists are empty, so a failure names exactly
 * what is wrong. They take a Queryable so the self-tests can run them inside a rolled-back
 * transaction that adds a deliberately bad table.
 */

/**
 * Explicit exceptions. Every entry needs a reason; keep this list short (ADR 0005).
 */
export const ALLOW = {
  /** Tables without a `tenant_id` column. */
  noTenantId: {
    tenants: 'The tenant root: its own `id` is the tenant id; RLS compares `id = app_tenant_id()`.',
  },
  /** Unique indexes on tenant tables that do not include `tenant_id` (primary keys excluded). */
  globalUnique: {
    tenants_student_no_prefix_key:
      'STU-07: student prefixes are globally unique; provisioning is owner-only.',
    tenants_slug_key: 'Slugs are global: `<slug>.remix.lk` must map to exactly one tenant.',
    tenant_domains_host_key:
      'A host belongs to exactly one tenant. The app role cannot write tenant_domains, so this constraint can never leak another tenant to it.',
  },
  /** SECURITY DEFINER functions (each returns only tenantPublicSchema fields). */
  securityDefiner: {
    invoice_job_tenants:
      'ADR 0012 cron fan-out: active/trial tenant UUIDs only, no tenant data; actual jobs use withTenant.',
    resolve_tenant_by_slug: 'TEN-01 host → tenant before a tenant context exists.',
    resolve_tenant_by_domain: 'TEN-01 verified custom domain → tenant.',
  },
} as const;

const APP_ROLES = ['remix_app', 'remix_readonly', 'remix_platform'] as const;
const OWNER = 'remix_owner';

/** ADR 0008: FORCE binds even the owner, through a separate tenant-scoped owner policy. */
export const LEDGER_UPDATE_COLUMNS: Readonly<Record<string, readonly string[]>> = {
  student_cards: ['status', 'revoked_at', 'revoked_by', 'revoke_reason'],
  tenant_settings: [
    'due_day',
    'reminders_enabled',
    'remind_before_days',
    'remind_after_days',
    'bank_details',
    'receipt_address',
    'receipt_phone',
    'receipt_footer',
  ],
  tenant_integrations: ['config', 'secret_ciphertext', 'secret_nonce', 'key_id'],
  invoices: ['paid_cents', 'status'],
  invoice_lines: ['void_reason', 'voided_at'],
  payments: [],
  payment_allocations: [],
  receipts: ['pdf_key', 'reversed_at'],
};

/** RLS on, ≥1 policy, tenant_id, tenant-scoped key, owner, updated_at trigger, factory entry. */
export async function tableViolations(
  db: Queryable,
  factoryTables: readonly string[],
): Promise<string[]> {
  const tables = await rows<{
    name: string;
    kind: string;
    rls: boolean;
    policies: number;
    has_tenant_id: boolean;
    tenant_key: boolean;
    has_updated_at: boolean;
    has_updated_at_trigger: boolean;
    owner: string;
  }>(
    db,
    sql`
      with t as (
        select c.oid, c.relname, c.relkind, c.relrowsecurity, c.relowner,
          (select a.attnum from pg_catalog.pg_attribute a
            where a.attrelid = c.oid and a.attname = 'tenant_id' and not a.attisdropped
              and a.attnotnull and a.atttypid = 'uuid'::regtype) as tenant_att,
          (select k.conkey from pg_catalog.pg_constraint k
            where k.conrelid = c.oid and k.contype = 'p') as pk
        from pg_catalog.pg_class c
        where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p', 'v', 'm', 'f')
      )
      select t.relname as name, t.relkind::text as kind, t.relrowsecurity as rls,
        (select count(*) from pg_catalog.pg_policy p where p.polrelid = t.oid)::int as policies,
        t.tenant_att is not null as has_tenant_id,
        coalesce(t.tenant_att = any(t.pk) or exists (
          select 1 from pg_catalog.pg_constraint u
          where u.conrelid = t.oid and u.contype = 'u'
            and u.conkey @> (array[t.tenant_att] || t.pk)
            and u.conkey <@ (array[t.tenant_att] || t.pk)
        ), false) as tenant_key,
        exists (select 1 from pg_catalog.pg_attribute a
          where a.attrelid = t.oid and a.attname = 'updated_at' and not a.attisdropped) as has_updated_at,
        exists (select 1 from pg_catalog.pg_trigger g
          join pg_catalog.pg_proc f on f.oid = g.tgfoid
          where g.tgrelid = t.oid and not g.tgisinternal and f.proname = 'set_updated_at') as has_updated_at_trigger,
        pg_catalog.pg_get_userbyid(t.relowner) as owner
      from t
      order by t.relname
    `,
  );

  const problems: string[] = [];
  const noTenantId: Record<string, string> = ALLOW.noTenantId;
  for (const t of tables) {
    if (t.kind !== 'r' && t.kind !== 'p') {
      problems.push(
        `${t.name}: views/foreign tables are not allowed in public (they bypass RLS); use the platform schema`,
      );
      continue;
    }
    if (!t.rls) problems.push(`${t.name}: row level security is not enabled`);
    if (t.policies < 1) problems.push(`${t.name}: has no RLS policy`);
    if (!t.has_tenant_id && !(t.name in noTenantId)) {
      problems.push(`${t.name}: no "tenant_id uuid not null" column and not allow-listed`);
    }
    if (t.has_tenant_id && !t.tenant_key) {
      problems.push(
        `${t.name}: needs unique (tenant_id, <primary key>) for composite foreign keys`,
      );
    }
    if (t.has_updated_at && !t.has_updated_at_trigger) {
      problems.push(`${t.name}: has updated_at but no set_updated_at trigger`);
    }
    if (t.owner !== OWNER) problems.push(`${t.name}: owned by ${t.owner}, not ${OWNER}`);
    if (!factoryTables.includes(t.name)) {
      problems.push(`${t.name}: missing from the isolation factory map (test/tables.ts)`);
    }
  }
  for (const name of factoryTables) {
    if (!tables.some((t) => t.name === name)) {
      problems.push(`${name}: in the factory map but not a table in public`);
    }
  }
  return problems;
}

/** Every policy targets only RLS-bound app roles and compares against app_tenant_id(). */
export async function policyViolations(db: Queryable): Promise<string[]> {
  const policies = await rows<{
    table: string;
    policy: string;
    roles: string[];
    permissive: string;
    qual: string | null;
    with_check: string | null;
  }>(
    db,
    sql`
      select tablename as table, policyname as policy, roles::text[] as roles, permissive,
        qual, with_check
      from pg_catalog.pg_policies where schemaname = 'public'
      order by tablename, policyname
    `,
  );
  const problems: string[] = [];
  for (const p of policies) {
    const label = `${p.table}.${p.policy}`;
    for (const role of p.roles) {
      const tenantBoundOwner =
        role === OWNER && p.table in LEDGER_UPDATE_COLUMNS && p.policy === 'tenant_owner';
      if (role !== 'remix_app' && role !== 'remix_readonly' && !tenantBoundOwner) {
        problems.push(`${label}: applies to ${role} (only remix_app / remix_readonly allowed)`);
      }
    }
    for (const [clause, expr] of [
      ['USING', p.qual],
      ['WITH CHECK', p.with_check],
    ] as const) {
      if (expr !== null && !expr.includes('app_tenant_id()')) {
        problems.push(`${label}: ${clause} (${expr}) does not compare with app_tenant_id()`);
      }
    }
  }
  return problems;
}

/** Foreign keys between tenant tables must carry tenant_id on both sides (composite). */
export async function foreignKeyViolations(db: Queryable): Promise<string[]> {
  const fks = await rows<{
    name: string;
    table: string;
    ref: string;
    cols: string[];
    ref_cols: string[];
  }>(
    db,
    sql`
      select con.conname as name, c.relname as table, r.relname as ref,
        array(select a.attname::text from unnest(con.conkey) with ordinality k(n, i)
          join pg_catalog.pg_attribute a on a.attrelid = con.conrelid and a.attnum = k.n
          order by k.i) as cols,
        array(select a.attname::text from unnest(con.confkey) with ordinality k(n, i)
          join pg_catalog.pg_attribute a on a.attrelid = con.confrelid and a.attnum = k.n
          order by k.i) as ref_cols
      from pg_catalog.pg_constraint con
      join pg_catalog.pg_class c on c.oid = con.conrelid
      join pg_catalog.pg_class r on r.oid = con.confrelid
      where con.contype = 'f' and c.relnamespace = 'public'::regnamespace
      order by c.relname, con.conname
    `,
  );
  const problems: string[] = [];
  for (const fk of fks) {
    if (fk.ref === 'tenants') {
      if (fk.cols.join() !== 'tenant_id') {
        problems.push(`${fk.table}.${fk.name}: a reference to tenants must be on tenant_id`);
      }
      continue;
    }
    const position = fk.cols.indexOf('tenant_id');
    if (position < 0 || fk.ref_cols[position] !== 'tenant_id') {
      problems.push(
        `${fk.table}.${fk.name}: (${fk.cols.join(', ')}) → ${fk.ref}(${fk.ref_cols.join(', ')}) must include tenant_id on both sides`,
      );
    }
  }
  return problems;
}

/** Indexes on tenant tables lead with tenant_id; unique ones include it (ADR 0005). */
export async function indexViolations(db: Queryable): Promise<string[]> {
  const indexes = await rows<{ index: string; table: string; is_unique: boolean; cols: string[] }>(
    db,
    sql`
      select i.relname as index, c.relname as table, x.indisunique as is_unique,
        array(select coalesce(a.attname::text, '<expr>')
          from unnest(x.indkey::int2[]) with ordinality k(n, o)
          left join pg_catalog.pg_attribute a on a.attrelid = c.oid and a.attnum = k.n
          order by k.o) as cols
      from pg_catalog.pg_index x
      join pg_catalog.pg_class i on i.oid = x.indexrelid
      join pg_catalog.pg_class c on c.oid = x.indrelid
      where c.relnamespace = 'public'::regnamespace and not x.indisprimary
        and exists (select 1 from pg_catalog.pg_attribute t
          where t.attrelid = c.oid and t.attname = 'tenant_id' and not t.attisdropped)
      order by c.relname, i.relname
    `,
  );
  const allowed: Record<string, string> = ALLOW.globalUnique;
  const problems: string[] = [];
  for (const ix of indexes) {
    if (ix.index in allowed) continue;
    if (ix.cols[0] !== 'tenant_id') {
      problems.push(`${ix.table}.${ix.index}: (${ix.cols.join(', ')}) must lead with tenant_id`);
    }
  }
  return problems;
}

/** Roles: nobody bypasses RLS, app roles are not owners and own nothing. */
export async function roleViolations(db: Queryable): Promise<string[]> {
  const roles = await rows<{
    name: string;
    superuser: boolean;
    bypassrls: boolean;
    createrole: boolean;
    createdb: boolean;
    member_of_owner: boolean;
    owns: number;
  }>(
    db,
    sql`
      select r.rolname as name, r.rolsuper as superuser, r.rolbypassrls as bypassrls,
        r.rolcreaterole as createrole, r.rolcreatedb as createdb,
        r.rolname <> 'remix_owner' and pg_catalog.pg_has_role(r.oid, 'remix_owner', 'MEMBER') as member_of_owner,
        ((select count(*) from pg_catalog.pg_class where relowner = r.oid)
          + (select count(*) from pg_catalog.pg_proc where proowner = r.oid)
          + (select count(*) from pg_catalog.pg_type where typowner = r.oid)
          + (select count(*) from pg_catalog.pg_namespace where nspowner = r.oid))::int as owns
      from pg_catalog.pg_roles r where r.rolname like 'remix\\_%'
      order by r.rolname
    `,
  );
  const problems: string[] = [];
  const expected = new Set<string>([OWNER, ...APP_ROLES]);
  for (const r of roles) {
    expected.delete(r.name);
    if (r.superuser) problems.push(`${r.name}: is SUPERUSER`);
    if (r.bypassrls) problems.push(`${r.name}: has BYPASSRLS`);
    if (r.name === OWNER) continue;
    if (r.createrole || r.createdb) problems.push(`${r.name}: has CREATEROLE/CREATEDB`);
    if (r.member_of_owner) problems.push(`${r.name}: is a member of ${OWNER}`);
    if (r.owns > 0) problems.push(`${r.name}: owns ${r.owns} database objects`);
  }
  for (const missing of expected) problems.push(`${missing}: role does not exist`);

  const foreign = await rows<{ object: string; owner: string }>(
    db,
    sql`
      select 'table ' || relname as object, pg_catalog.pg_get_userbyid(relowner) as owner
        from pg_catalog.pg_class where relnamespace = 'public'::regnamespace
      union all
      select 'function ' || proname, pg_catalog.pg_get_userbyid(proowner)
        from pg_catalog.pg_proc where pronamespace = 'public'::regnamespace
      union all
      select 'type ' || typname, pg_catalog.pg_get_userbyid(typowner)
        from pg_catalog.pg_type where typnamespace = 'public'::regnamespace
    `,
  );
  for (const f of foreign) {
    if (f.owner !== OWNER) problems.push(`${f.object}: owned by ${f.owner}, not ${OWNER}`);
  }
  return problems;
}

/** PUBLIC gets nothing; SECURITY DEFINER functions are allow-listed, pinned and app-only. */
export async function publicAndFunctionViolations(db: Queryable): Promise<string[]> {
  const publicGrants = await rows<{ object: string }>(
    db,
    sql`
      select 'database ' || datname as object from pg_catalog.pg_database
        where datname = pg_catalog.current_database()
          and (datacl is null or exists (select 1 from pg_catalog.aclexplode(datacl) e where e.grantee = 0))
      union all
      select 'schema public' from pg_catalog.pg_namespace
        where nspname = 'public'
          and (nspacl is null or exists (select 1 from pg_catalog.aclexplode(nspacl) e where e.grantee = 0))
      union all
      select 'table ' || relname from pg_catalog.pg_class
        where relnamespace = 'public'::regnamespace and relacl is not null
          and exists (select 1 from pg_catalog.aclexplode(relacl) e where e.grantee = 0)
      union all
      select 'function ' || proname from pg_catalog.pg_proc
        where pronamespace = 'public'::regnamespace
          and (proacl is null or exists (select 1 from pg_catalog.aclexplode(proacl) e where e.grantee = 0))
      union all
      select 'type ' || typname from pg_catalog.pg_type
        where typnamespace = 'public'::regnamespace and typtype in ('e', 'd')
          and (typacl is null or exists (select 1 from pg_catalog.aclexplode(typacl) e where e.grantee = 0))
    `,
  );
  const problems = publicGrants.map((g) => `${g.object}: PUBLIC has privileges`);

  const definers = await rows<{
    name: string;
    config: string[] | null;
    app: boolean;
    readonly: boolean;
    platform: boolean;
  }>(
    db,
    sql`
      select p.proname as name, p.proconfig as config,
        pg_catalog.has_function_privilege('remix_app', p.oid, 'EXECUTE') as app,
        pg_catalog.has_function_privilege('remix_readonly', p.oid, 'EXECUTE') as readonly,
        pg_catalog.has_function_privilege('remix_platform', p.oid, 'EXECUTE') as platform
      from pg_catalog.pg_proc p
      where p.pronamespace = 'public'::regnamespace and p.prosecdef
      order by p.proname
    `,
  );
  const allowed: Record<string, string> = ALLOW.securityDefiner;
  for (const f of definers) {
    if (!(f.name in allowed))
      problems.push(`function ${f.name}: SECURITY DEFINER but not allow-listed`);
    if (!f.config?.includes('search_path=pg_catalog, public')) {
      problems.push(
        `function ${f.name}: SECURITY DEFINER without SET search_path = pg_catalog, public`,
      );
    }
    if (!f.app) problems.push(`function ${f.name}: remix_app cannot execute it`);
    if (f.readonly || f.platform) {
      problems.push(`function ${f.name}: executable by a role other than remix_app`);
    }
  }
  for (const name of Object.keys(allowed)) {
    if (!definers.some((f) => f.name === name)) problems.push(`function ${name}: missing`);
  }

  const schemaAccess = await rows<{ role: string; usage: boolean; create: boolean }>(
    db,
    sql`
      select r as role,
        pg_catalog.has_schema_privilege(r, 'public', 'USAGE') as usage,
        pg_catalog.has_schema_privilege(r, 'public', 'CREATE') as create
      from unnest(array['remix_app', 'remix_readonly', 'remix_platform']) as r
    `,
  );
  for (const s of schemaAccess) {
    if (s.create) problems.push(`${s.role}: can CREATE in schema public`);
    if (s.usage !== (s.role !== 'remix_platform')) {
      problems.push(`${s.role}: unexpected USAGE=${s.usage} on schema public`);
    }
  }
  return problems;
}

/** Exact table privileges per role, derived from each table's `access` in the factory map. */
export async function grantViolations(
  db: Queryable,
  access: Readonly<Record<string, Access>>,
): Promise<string[]> {
  const actual = await rows<{ table: string; role: string; privilege: string; granted: boolean }>(
    db,
    sql`
      select c.relname as table, r as role, p as privilege,
        case when p in ('SELECT', 'INSERT', 'UPDATE', 'REFERENCES')
          then pg_catalog.has_any_column_privilege(r, c.oid, p)
          else pg_catalog.has_table_privilege(r, c.oid, p) end as granted
      from pg_catalog.pg_class c
      cross join unnest(array['remix_app', 'remix_readonly', 'remix_platform']) as r
      cross join unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) as p
      where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p')
      order by 1, 2, 3
    `,
  );
  const expected = (table: string, role: string): readonly string[] => {
    const level = access[table];
    if (level === undefined) return [];
    if (role === 'remix_app') return APP_PRIVILEGES[level];
    if (role === 'remix_readonly') return ['SELECT'];
    return [];
  };
  const problems: string[] = [];
  for (const g of actual) {
    const should = expected(g.table, g.role).includes(g.privilege);
    if (g.granted !== should) {
      problems.push(
        `${g.table}: ${g.role} ${g.granted ? 'has' : 'lacks'} ${g.privilege}${g.privilege === 'TRUNCATE' ? ' (TRUNCATE ignores RLS)' : ''}`,
      );
    }
  }
  const columns = await rows<{ table: string; column: string; granted: boolean; forced: boolean }>(
    db,
    sql`
    select c.relname as table, a.attname as column, c.relforcerowsecurity as forced,
      has_column_privilege('remix_app', c.oid, a.attname, 'UPDATE') as granted
    from pg_class c join pg_attribute a on a.attrelid = c.oid
    where c.relnamespace = 'public'::regnamespace and a.attnum > 0 and not a.attisdropped
  `,
  );
  for (const c of columns) {
    const allowed = LEDGER_UPDATE_COLUMNS[c.table];
    if (!allowed) continue;
    if (!c.forced) problems.push(`${c.table}: ledger RLS is not forced`);
    if (c.granted !== allowed.includes(c.column))
      problems.push(`${c.table}.${c.column}: unexpected UPDATE grant=${c.granted}`);
  }
  return problems;
}
