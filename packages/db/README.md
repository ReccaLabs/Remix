# @remix/db

Database layer of the ReMix platform: Drizzle schema, hand-written security migrations
(roles, RLS, grants, resolver functions), `withTenant()`, host → tenant resolution, the dev
seed, the `tenant:create` CLI and the tenant-isolation suite. Design: [ADR 0005](../../docs/decisions/0005-tenancy-shared-schema-rls.md)
(tenancy + RLS), [ADR 0007](../../docs/decisions/0007-ids-money-time-numbering.md) (ids, money,
numbering), [ADR 0004](../../docs/decisions/0004-own-authentication.md) (sessions/devices).

```ts
import { createDb, verifyAppRole, withTenant, resolveTenantByHost, schema } from '@remix/db';

const db = createDb(process.env.DATABASE_URL); // remix_app — RLS enforced
await verifyAppRole(db); // refuse to boot as an owner/superuser
const tenant = await resolveTenantByHost(db, host, { baseDomains: ['remix.lk'], cache });
if (!tenant) return notFound();
const rows = await withTenant(db, tenant.id, (tx) => tx.select().from(schema.classes));
```

Rules: tenant data only inside `withTenant` and only through its `tx` (outside it every tenant
table reads empty); never connect the app with the owner URL; never `SET` (session-level)
`app.tenant_id`.

## Public API

| Export | What it does |
| --- | --- |
| `createDb(url, { max?, applicationName? })` | Pool-backed Drizzle client (`db.$client.end()` to close). Use the `remix_app` URL. |
| `createOwnerDb(url)` | Same, for migrations/seed/CLIs as `remix_owner` (bypasses RLS). Never in a running app. |
| `verifyAppRole(db)` | Throws if the pool's role is superuser, `BYPASSRLS`, or owns tables. Call at API boot. |
| `withTenant(db, tenantId, fn, config?)` | Validates the UUID, opens a transaction (or savepoint when `db` is a `tx`), `set_config('app.tenant_id', id, true)`, runs `fn(tx)`. Nesting a different tenant throws. |
| `resolveTenantByHost(db, host, { baseDomains, cache? })` | `TenantPublic \| null`. `<slug>.<base>` → by slug; any other dotted host → verified `tenant_domains`; reserved slugs, apex, deeper sub-domains, IPs and garbage → `null`. Suspended tenants resolve with their status. Optional cache port (`host:<host>`, 60 s, positive results only, re-validated on read). |
| `normaliseHost(raw)`, `classifyHost(host, baseDomains)` | The pure host logic behind the resolver. |
| `allocateNumbers(tx, kind, count?, period?)`, `formatStudentNo(prefix, n)` | Gap-free per-tenant counters (ADR 0007) inside `withTenant`; `BR-1042` formatting. |
| `runMigrations(ownerUrl)` | Applies pending migrations in one transaction. |
| `schema` | All tables and enums (`schema.tenants`, `schema.classes`, …). Types `Db`, `Tx`, `Queryable`. |

## Environment

| Variable | Used by | Role |
| --- | --- | --- |
| `DATABASE_URL` | API, workers | `remix_app` |
| `DATABASE_OWNER_URL` | `migrate`, `seed`, `tenant:create`, `tenant:reset-owner-password` | `remix_owner` — deploy pipeline only |
| `DATABASE_PLATFORM_URL` | platform module (later) | `remix_platform` |
| `DATABASE_READONLY_URL` | support/exports (later) | `remix_readonly` |
| `SEED_ALLOW_REMOTE` | `seed` | `true` to seed a non-local host (never prod) |

Copy `.env.example` to `.env` (git-ignored); the CLIs load it, real environment variables win.

## Local setup

```bash
docker compose -f infra/docker/compose.yaml up -d      # Postgres 18 + Valkey + Mailpit + S3
cp packages/db/.env.example packages/db/.env
pnpm --filter @remix/db migrate
pnpm --filter @remix/db seed
```

If port 5432 is taken, set `POSTGRES_PORT` in `infra/docker/.env` and the same port in
`packages/db/.env`. The init script `infra/docker/postgres/init/01-roles.sql` creates the roles
and the `remix` database only when the volume is first created (`docker compose … down -v` to
start over).

### Seed logins (dev only — never real credentials)

Every seeded user has the password **`remix-dev-password`**. The seed is deterministic and
reset-first: it deletes and recreates only these three tenants.

| Tenant (dev host) | Who | Login |
| --- | --- | --- |
| `kamalphysics.localhost:3001` — Institute plan, active, 2,000 students `BR-0801…BR-2800`, 6 classes | Kamal Jayasinghe (owner, teacher) | `+94770001180` or `kamal@kamalphysics.test` |
| | Sunil Perera (admin) | `+94770001181` or `sunil@kamalphysics.test` |
| | Dulmini Rathnayake (cashier) | `+94770001182` |
| | Ravindu Bandara (teacher) | `+94770001183` |
| | Nimali Perera (student `BR-1042`) | `+94710001042` |
| | any student `BR-n` | `+9471` + `n` padded to 7 digits |
| `royalscience.localhost:3001` — Tutor plan, 40 students `RS-0001…RS-0040` | Ruwan Wickramasinghe (owner, teacher) | `+94770002200`; students `+9472…` |
| `closedacademy.localhost:3001` — **suspended** | Chaminda Silva (owner) | `+94770003300`; students `+9475…` |

Custom domains: `kamalphysics.test` (verified → resolves), `pending.kamalphysics.test`
(unverified → never resolves). About 1 % of students are `disabled`.

### Create a tenant

```bash
pnpm --filter @remix/db tenant:create -- --slug galle-maths --name "Galle Maths Centre" \
  --plan tutor --owner-phone 0771234567 --owner-name "Chathura Mendis" [--prefix GM]
```

Validates with `tenantSlugSchema` / `sriLankaMobile`, creates the tenant (`trial`), an owner
staff user and an audit entry, and prints a random temporary password **once**
(`must_change_password = true`). Prefix defaults to the name's initials.

### Reset an owner's password

```bash
pnpm --filter @remix/db tenant:reset-owner-password -- --slug galle-maths [--owner-phone 0771234567]
```

For a lost password, or an owner who never replaced the temporary one (until the first-login
change, AUTH-07, is enforced in the API). Sets a new random temporary password (printed **once**,
`must_change_password = true`), revokes every live session of that owner and writes a
`user.password_reset` audit entry. `--owner-phone` is only needed when the tenant has several
owners. The API audits any login that still uses a temporary password as
`auth.login.temporary_password`.

## Migrations

- `migrations/` holds drizzle-kit output and hand-written SQL in one journal, applied in order
  by `pnpm --filter @remix/db migrate` (CI/deploy, never at app boot):
  `0000_bootstrap` (role checks, PUBLIC revokes, `app_tenant_id()`, `set_updated_at()`),
  `0001_tenancy_schema` (generated tables), `0002_rls_grants_resolvers` (RLS, policies,
  grants, triggers, resolver functions).
- Schema change: edit `src/schema/*`, then `pnpm --filter @remix/db db:generate --name=<what>`.
- Security SQL: `pnpm --filter @remix/db db:generate --custom --name=<what>` and write it by hand.
- **Never `drizzle-kit push`** — it would skip the hand-written security migrations.
- Migrations must be backward compatible (expand → migrate → contract).

## Adding a table (checklist)

1. Schema in `src/schema/<area>.ts`, exported from `src/schema/index.ts`:
   `tenantId()` column, `id()` (UUIDv7) or a key that includes `tenant_id`,
   `unique('<t>_tenant_id_id_key').on(t.tenantId, t.id)`, `...timestamps()`, money as
   `bigint(..., { mode: 'number' })` named `*_cents`, every index leading with `tenant_id`.
2. References to other tenant tables are **composite**: `foreignKey({ columns: [t.tenantId, t.xId],
   foreignColumns: [x.tenantId, x.id] })`.
3. `pnpm db:generate --name=…`, then a custom migration with: `set_updated_at` trigger,
   `ENABLE ROW LEVEL SECURITY`, a `tenant_isolation` policy `TO remix_app, remix_readonly`
   comparing `tenant_id = (SELECT public.app_tenant_id())` (USING **and** WITH CHECK), and the
   grants (never `TRUNCATE`/`REFERENCES`/`TRIGGER`; `remix_readonly` gets `SELECT`).
4. Add the table to `TABLES` in `test/tables.ts` (`access`, `key`, `fresh`, `crossTenantRefs`)
   and its rows to `createWorld`. Typecheck fails until you do; the catalog test fails if the
   table lacks RLS, a policy, its key, trigger, grants or factory entry.
5. `pnpm --filter @remix/db test` — all green. Global (non-tenant) tables go in a separate
   `platform` schema, never in `public`.

## Isolation suite

`pnpm --filter @remix/db test` runs unit tests and the isolation suite (`test:unit`,
`test:isolation` separately). The suite needs Postgres: it creates a fresh `remix_test_<id>` database
on the dev stack's Postgres (`TEST_DATABASE_URL` overrides the superuser URL; local hosts only) and
drops it afterwards, or starts a Testcontainers `postgres:18-alpine` when none is reachable
(`TEST_DATABASE=container` forces it; see `src/testing.ts`). It creates the four roles if missing,
runs the real migrations as `remix_owner`, and
checks the catalog (RLS everywhere, policies, composite FKs, index order, exact grants, no
`BYPASSRLS`, no PUBLIC privileges, pinned `SECURITY DEFINER` functions) plus a generated
cross-tenant test per table (read, insert, update, move, delete, `TRUNCATE`, composite FKs, no
context = empty), `withTenant`, the resolver, counters, the seed and `tenant:create`.

## Production roles

Roles are cluster-level, so migrations do not create them; `0000_bootstrap` refuses to run if
they are missing or unsafe. The operator (or IaC) creates them once per cluster, with secrets
from the secret store:

```sql
CREATE ROLE remix_owner    LOGIN PASSWORD :'owner_pw'    NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOINHERIT;
CREATE ROLE remix_app      LOGIN PASSWORD :'app_pw'      NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOINHERIT;
CREATE ROLE remix_platform LOGIN PASSWORD :'platform_pw' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOINHERIT;
CREATE ROLE remix_readonly LOGIN PASSWORD :'readonly_pw' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOINHERIT;
ALTER ROLE remix_owner SET timezone = 'UTC';   -- likewise for the other three (ADR 0007)
CREATE DATABASE remix OWNER remix_owner;       -- the owner must own the database (schema revokes)
```

- No role is a member of another; `remix_owner`'s credential lives only in the deploy pipeline.
- RLS is `ENABLE`d, not `FORCE`d: the owner bypasses it for migrations, backfills and the CLIs.
- Each role's connection string is a separate secret; app and platform pools never share one.
- Backups use WAL tooling with a replication role, not `remix_readonly`.
