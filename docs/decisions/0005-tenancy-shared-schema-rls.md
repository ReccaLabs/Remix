# 0005 — Tenancy: shared schema + Postgres Row Level Security

- **Status:** Accepted · 2026-10-02
- **Settles:** [03-architecture §3](../plan/03-architecture.md#3-multi-tenancy) (model, enforcement, roles, platform queries); [roadmap §6](../plan/05-roadmap.md#6-decision-backlog-adrs) item 0005; the "isolation in the database" principle. Mitigates threat **T1** and risk **R4**.

## Context

Hundreds of institutes, each with up to a few thousand students, on a budget of roughly €80–110/month at the paying stage. A cross-tenant leak (one institute seeing another's students or payments) is the worst failure we can have (T1, Critical). The isolation guarantee must survive a forgotten `WHERE` clause.

## Decision

### Model

One database, one schema, and `tenant_id uuid not null` on every tenant table. Global tables (plans, platform staff, subscriptions, leads) live in a separate `platform` schema and are on the catalog check's allow-list.

### Roles

| Role             | Login                 | Purpose and limits                                                                                                                                                                                                              |
| ---------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `remix_owner`    | yes, deploy step only | Owns every table, view and function, and runs migrations. Its credential exists only in the deploy pipeline, never in a running app or worker.                                                                                  |
| `remix_app`      | yes                   | The API and worker. `NOSUPERUSER NOBYPASSRLS NOCREATEROLE NOCREATEDB`, owns nothing. Table-level DML grants only; **never `TRUNCATE`** (it ignores RLS). `INSERT, SELECT` only on `audit_logs`.                                 |
| `remix_platform` | yes                   | The platform module's separate pool. `NOBYPASSRLS`, no grants on tenant base tables. Reads cross-tenant data **only** through views/functions in the `platform` schema (below), and has normal access to the `platform` tables. |
| `remix_readonly` | yes                   | `SELECT` only and `NOBYPASSRLS`, so it is bound by RLS like the app. Used for single-tenant support queries and exports with `app.tenant_id` set. Physical backups use WAL tooling with a replication role, not this.           |

`PUBLIC` gets nothing: no `CREATE` on schemas and no `EXECUTE` on our functions (Postgres grants `EXECUTE` to `PUBLIC` by default, so we revoke it).

### Policies

```sql
create function app_tenant_id() returns uuid language sql stable as
  $$ select nullif(current_setting('app.tenant_id', true), '')::uuid $$;

alter table <t> enable row level security;
create policy tenant_isolation on <t> to remix_app, remix_readonly
  using (tenant_id = app_tenant_id()) with check (tenant_id = app_tenant_id());
```

- Unset context → `NULL` → **zero rows**, and inserts fail. `nullif` matters: after a transaction-local setting ends, Postgres reports `''`, not `NULL`.
- RLS is `ENABLE`d, not `FORCE`d. The owner bypasses it so expand/migrate/contract backfills work, which is why the owner credential never reaches a running process.
- Role scoping (teacher → own classes) is added later as further `restrictive` policies, where 03-architecture §4 asks for defence in depth. `withTenant` will then also set `app.user_id`.

### `withTenant()`

`withTenant(db, tenantId, tx => …)` (public API in [phase-1 §4](../plan/phase-1.md#4-tracks)) opens a transaction, runs `select set_config('app.tenant_id', $1, true)` (transaction-local) and runs the callback. Session-level `SET` is forbidden: with PgBouncer transaction pooling it would leak into the next client's transaction. Nesting `withTenant` with a different tenant throws. Every BullMQ job carries `tenantId` and runs inside `withTenant`.

### Schema rules

- **Composite tenant foreign keys.** Every tenant table has `unique (tenant_id, id)`, and references are `(tenant_id, x_id) references x (tenant_id, id)`. FK checks ignore RLS, so without this a bug could link tenant A's enrolment to tenant B's class.
- Unique constraints include `tenant_id` (`(tenant_id, phone)`), so constraint errors can't reveal another tenant's data. Indexes on tenant tables lead with `tenant_id`.

### Host → tenant resolution

The app role can't read `tenants` without a tenant context, so resolution goes through `SECURITY DEFINER` functions owned by `remix_owner`:

- `resolve_tenant_by_slug(slug)` and `resolve_tenant_by_domain(host)` (verified `tenant_domains` only).
- They return exactly the public fields of `tenantPublicSchema` (id, slug, name, status, plan, locale, timezone, brand colour, logo), with `SET search_path = pg_catalog, public` and `EXECUTE` granted to `remix_app` only.
- `resolveTenantByHost()` in `packages/db` splits base domain vs custom host in TypeScript and caches results in Valkey for 60 s under `host:<host>`. It is the only cache key without a tenant prefix, and it holds only public fields.

### Platform cross-tenant access

Views and functions in the `platform` schema, created by migrations and owned by `remix_owner`, with `SELECT`/`EXECUTE` granted to `remix_platform` only. Each exposes only what a platform screen needs (counts, usage, status) and is reviewed like an RLS policy. Platform actions on one tenant's data (feature flags, suspension, impersonation) go through the `remix_app` pool with `withTenant` for that one tenant, and are audit-logged. RLS is never disabled.

### Audit and other stores

- `audit_logs` is append-only for the app: no `UPDATE`/`DELETE` grants. Retention purging (1 year) runs through a `SECURITY DEFINER` function that only deletes rows past retention.
- Cache keys are `t:<tenantId>:…`. Object-storage keys are `<tenantId>/…`, and signed-URL issuance checks the prefix against the current tenant.

### Proving it (CI, every PR)

- **Catalog check:** every table in `public` has `tenant_id`, RLS enabled, a policy, and `unique (tenant_id, id)`, or is on the allow-list. No role other than the owner owns objects. No ReMix role has `BYPASSRLS`. `remix_app` has no `TRUNCATE`. Every `SECURITY DEFINER` function has a fixed `search_path` and no `PUBLIC` execute.
- **Generated isolation suite** ([04-quality §4.1](../plan/04-quality.md#41-pyramid)): for each tenant table, as `remix_app` in A's context:
  - B's rows are invisible;
  - inserting with B's id fails;
  - updates and deletes of B's rows affect 0 rows;
  - with no context, the table reads empty.

  For each endpoint, A's cookie or ids on B's host → 401/404. A deliberately broken policy must fail CI (Phase 1 exit criterion).

## Alternatives considered

- **Schema per tenant.** Migrations run N times, the catalog bloats into hundreds of schemas, and `search_path` switching on pooled connections is itself a leak vector. Workable at our size, but more operations for weaker guarantees than RLS.
- **Database per tenant.** Strongest isolation, but a Postgres with HA and backups per institute is impossible at our price points, and platform reporting becomes a fan-out.
- **Application-level filtering only.** One missing `WHERE tenant_id = …` is a leak, which is exactly what T1 says we must survive.

## Consequences

- Every new table costs an RLS policy, composite keys and an isolation test (Definition of Done, [04-quality §3.1](../plan/04-quality.md#31-story--pull-request)). The CI check makes forgetting impossible.
- A query outside `withTenant` returns nothing instead of everything. Bugs fail closed and show up as empty screens in tests.
- **Scale-out by cells:** near ~50 institutes or ~20k active students per DB pair, new tenants go to a new cell (same schema, same roles) via an edge `tenant → cell` table. UUIDv7 ids ([ADR 0007](0007-ids-money-time-numbering.md)) are globally unique, so moving a tenant is an owner-run copy of its rows.
- 03-architecture §3 says platform views are "owned by `remix_platform`". They must be owned by `remix_owner`, because a view owned by an RLS-bound role sees zero rows. This ADR is authoritative.

## Security notes

- RLS policies, `SECURITY DEFINER` functions and platform views are security code: two reviewers, plus track S before Phase 1 exits.
- Connection strings per role are separate secrets. The app and platform pools never share credentials.
