# Phase 1 — execution board (Foundation & walking skeleton)

> Part of the [ReMix development plan](README.md). Scope and exit criteria: [05-roadmap.md → Phase 1](05-roadmap.md#phase-1--foundation--walking-skeleton-weeks-14). This page records **how** the phase is being built: tracks, branches, contracts, and status. Update it as tracks merge.

## 1. Working agreement

| Topic | Rule |
| --- | --- |
| Branches | `main` is always deployable. One short-lived branch per track: `feat/<area>-<topic>`, `fix/…`, `docs/…`, `chore/…`, `ci/…`. |
| Contracts first | Shared shapes land on `main` **before** parallel work starts: API schemas + endpoint registry in `packages/types/src/api`, the `packages/db` public API (below). Tracks never change another track's files; contract changes go through the lead. |
| Ownership | Each track owns a directory. Root files (`package.json`, `turbo.json`, `pnpm-workspace.yaml`, `.github/`) are changed only by the lead or the `ci/*` track. Dependencies are added with `pnpm --filter <pkg> add`; lockfile conflicts are resolved by re-running `pnpm install`. |
| Commits | Conventional Commits with feature IDs: `feat(auth): AUTH-01 student phone + password login`. Body explains *why*. Commits are authored by the repo owner; no AI co-author trailers. |
| Merge | Squash merge after the gates pass on the branch: `pnpm lint && pnpm typecheck && pnpm test && pnpm build`, plus the isolation suite. Security-sensitive tracks (auth, RLS, crypto) get an independent review before merge. |
| Verification | Every track ships tests with its code; integration tests run against real Postgres 18 (Testcontainers / Docker), never mocks of the database. |

## 2. Decisions this phase builds on

Each becomes an ADR in `docs/decisions/` (track **D**). Summary so parallel tracks agree:

| ADR | Decision |
| --- | --- |
| 0003 | Browser calls `/api/v1/*` **same-origin** on every host; the edge proxy (Kamal proxy in prod, Next.js rewrite in dev) routes it to `apps/api`. The API derives the tenant from the forwarded `Host`, trusting `X-Forwarded-Host` only from configured proxy addresses. CSRF: host-only `SameSite=Lax` cookies **plus** Origin / `Sec-Fetch-Site` verification on every state-changing request and JSON-only bodies (replaces the double-submit token — see the ADR for why). |
| 0004 | **Own auth** instead of Better Auth: per-tenant phone identities, RLS-scoped session/device tables and the 2-device rule fit poorly in a generic library. Argon2id (`@node-rs/argon2`, OWASP params), opaque 256-bit session tokens stored as SHA-256 hashes, host-only cookie, rotation every 15 min with reuse detection, 12 h (or 30 days with "stay signed in") absolute lifetime. |
| 0005 | Shared schema + RLS. Roles `remix_owner` (owns tables, migrations), `remix_app` (`NOBYPASSRLS`, API), `remix_platform`, `remix_readonly`. `app_tenant_id()` reads `current_setting('app.tenant_id', true)`; NULL → zero rows. `withTenant()` sets it with `set_config(…, true)` inside a transaction. Host → tenant resolution through a `SECURITY DEFINER` function, so the app role never reads other tenants. |
| 0006 | `apps/web` never touches the database. Server Components call the API through the typed client (`createApiClient` from `@remix/types/api`), forwarding the user's cookie and the tenant host. |
| 0007 | IDs are UUIDv7 (`uuidv7()` built into Postgres 18). Money is `bigint` cents. Times are `timestamptz` (UTC), shown in Asia/Colombo. |

## 3. Local development topology

| Thing | Value |
| --- | --- |
| Web (`apps/web`) | `http://<slug>.localhost:3001` (tenant) · `http://admin.localhost:3001` (platform) |
| API (`apps/api`) | `http://localhost:4000` — reached by the browser only via the web app's `/api/v1` rewrite |
| Site (`apps/site`) | `http://localhost:3000` (unchanged) |
| Base domains | `TENANT_BASE_DOMAINS=localhost` in dev, `remix.lk` in prod; any other host must be a verified row in `tenant_domains` |
| Stack | `infra/docker/compose.yaml`: Postgres 18, Valkey, Mailpit, MinIO |
| Seed tenants | `kamalphysics` (Institute plan, 2,000 students), `royalscience` (Tutor plan), `closedacademy` (suspended) |

## 4. Tracks

Wave 1 runs in parallel from the contracts commit. Wave 2 starts when its inputs are merged.

| Wave | Track | Branch | Owns | Delivers (feature IDs) |
| --- | --- | --- | --- | --- |
| 0 | Contracts | `feat/platform-contracts` | `packages/types/src/api`, this page | API schemas, endpoint registry, typed client |
| 1 | **A** Database | `feat/db-tenancy-rls` | `packages/db`, `infra/docker` | Drizzle schema, roles, RLS, `withTenant`, migrations, seed, isolation suite, `tenant:create` CLI |
| 1 | **B** UI kit | `feat/ui-app-primitives` | `packages/ui` | Button, Input, PhoneInput, PasswordInput, StatusBadge, EmptyState, Skeleton, StatCard, Toast, ConfirmDialog, DataTable v1, shells |
| 1 | **C** API core | `feat/api-core` | `apps/api` | NestJS skeleton, problem+json, Zod pipe, request context + logging, CSRF guard, health, provider interfaces + mocks, rate limiter |
| 1 | **W** Web core | `feat/web-host-routing` | `apps/web` | Next.js 16 app, host → area routing (`proxy.ts`), CSP nonces, i18n, server API client, error/404/unavailable pages |
| 1 | **D** Decisions | `docs/adr-phase-1` | `docs/decisions` | ADRs 0003–0007 |
| 2 | **E** Tenancy + auth API | `feat/auth-student-staff-login` | `apps/api/src/modules` | TEN-01/02/06, AUTH-01, AUTH-05 basic, sessions, devices, logout, `GET /me/classes` |
| 2 | **F** Portal + admin UI | `feat/web-portal-login` | `apps/web/src/app` | Student login, classes list, staff login, admin home skeleton |
| 3 | **G** E2E + CI | `ci/phase-1-pipeline` | `.github/`, root scripts, `e2e/` | Playwright smoke (login → classes, cross-tenant), Testcontainers + isolation suite in CI, one-command `pnpm dev` |
| 3 | **S** Security review | — | read-only | DEVELOPMENT.md §5 + threat model T1/T2/T6/T13 review of the merged result; fixes on `fix/*` |

### `packages/db` public API (contract for tracks C and E)

```ts
import { createDb, withTenant, resolveTenantByHost, schema } from '@remix/db';

const db = createDb(process.env.DATABASE_URL);              // connects as remix_app
const tenant = await resolveTenantByHost(db, 'kamalphysics.remix.lk', { baseDomains: ['remix.lk'] });
await withTenant(db, tenant.id, async (tx) => tx.select().from(schema.classes));
```

## 5. Status

| Track | Status |
| --- | --- |
| Contracts | ✅ merged |
| A · B · C · W · D | ⬜ |
| E · F | ⬜ |
| G · S | ⬜ |

**Not doable from a dev machine (owner action needed):** Hetzner staging server + Kamal deploy, Sentry project DSNs, Zoom Marketplace submission, PayHere/Text.lk/Bunny accounts — see [05-roadmap.md §3](05-roadmap.md#3-parallel-long-lead-tracks-start-week-1).
