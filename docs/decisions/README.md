# Architecture decision records

Short records of decisions that are expensive to reverse. Copy the format of an existing ADR, number sequentially, and never rewrite an accepted ADR — supersede it with a new one.

| # | Decision |
| --- | --- |
| [0001](0001-monorepo-and-static-marketing-site.md) | Monorepo, with remix.lk as a separate static app on Cloudflare Pages |
| [0002](0002-i18n-strategy.md) | next-intl, per-namespace messages, locales go live only after native review |
| [0003](0003-same-origin-api-via-edge-proxy.md) | Same-origin `/api/v1` on every host via the edge proxy; no CORS; Origin + Fetch Metadata CSRF guard |
| [0004](0004-own-authentication.md) | Own authentication (not Better Auth): Argon2id, hashed opaque session tokens, rotation with reuse detection, devices; addendum: SMS one-time codes |
| [0005](0005-tenancy-shared-schema-rls.md) | Tenancy: shared schema + Postgres RLS, DB roles, `withTenant()`, platform access via owned views |
| [0006](0006-web-api-data-access.md) | `apps/web` never touches the database; server and client call the API through the typed client |
| [0007](0007-ids-money-time-numbering.md) | UUIDv7 ids, `bigint` cents, UTC storage with Asia/Colombo business dates, per-tenant gap-free counters |
| [0012](0012-background-jobs.md) | Background jobs: BullMQ on Valkey, named queues, idempotent jobs keyed by business id, tenant id in every payload, cron via repeatable jobs |

Backlog (0008–0011, 0013–0017, each written before the phase that needs it): [roadmap §6](../plan/05-roadmap.md#6-decision-backlog-adrs).
