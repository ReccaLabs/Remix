# 0012 — Background jobs: BullMQ on Valkey

- **Status:** Accepted · 2026-10-03
- **Settles:** [Phase 2 plan C3](../plan/phase-2.md) and [03-architecture](../plan/03-architecture.md) "slow work → BullMQ"; [roadmap §6](../plan/05-roadmap.md#6-decision-backlog-adrs) item 0012.

## Context

Phase 2 needs work that must not run inside a request: SMS codes (AUTH-02), CSV student import, and later invoices, reminders and payment-reconciliation crons. The API already has a separate worker process (`apps/api/src/worker.ts`) built from the same codebase, and Valkey is already in the stack (rate limiter, C6). Jobs touch tenant data and external providers, so they must be retry-safe and tenant-safe.

## Decision

**BullMQ on Valkey**, in `apps/api/src/jobs`. No second broker, no Postgres-as-queue.

### Queues

One queue per kind of work, so a slow import cannot starve SMS. Names are a closed list in code (`QUEUES`): `sms` and `imports` in Phase 2, later `invoices` and `reminders`. Each queue has its own worker concurrency and default job options. Keys are prefixed `remix:jobs`, so they never collide with limiter or cache keys.

### Job contract

- **Typed.** Every queue has a Zod schema for its payload, validated on `add` and again in the worker (`z.strictObject`, unknown fields rejected).
- **Idempotent.** The BullMQ job id is the business key (`sms:<tenantId>:<messageId>`, `import:<importId>`). Adding the same id twice is a no-op while the job exists, and processors must be safe to run twice (the SMS provider already takes an idempotency key).
- **Retries.** Default 5 attempts with exponential backoff from 5 s. A processor throws `UnrecoverableError` to stop retrying (invalid input, a gateway "invalid number").
- **Dead letters.** A job that exhausts its attempts stays in BullMQ's `failed` set (kept 14 days; completed jobs are removed) and is logged at `error` with queue, job id and tenant id. Operators list and retry from there; nothing is silently dropped. Alerting on failed-set size comes with ADR 0013 (observability).
- **Tenant id in every payload.** `tenantId` is required by the base schema. The worker reaches tenant data only through `withTenant(tenantId, …)` ([ADR 0005](0005-tenancy-shared-schema-rls.md)) and never connects as an owner role.
- **No secrets in payloads.** Valkey is not encrypted at rest. Payloads carry ids and references (`credentialsRef`, an import's storage key), never passwords, API keys or tokens. The one unavoidable sensitive value is an OTP code inside SMS text; `sms` jobs are removed on completion and failed ones after 1 hour, and logs never print payload bodies or message text in production.

### Cron

No Phase 2 feature needs a cron; the first one (invoices, Phase 3) adds a schedule registration point to the worker. The rule is fixed now: scheduled work uses BullMQ repeatable jobs (`upsertJobScheduler`) with a fixed scheduler id, registered by the worker at boot. The scheduler id makes registration idempotent across restarts and across worker nodes, and BullMQ hands each tick to exactly one worker, which is the lock. A cron tick only enqueues per-tenant jobs; the real work is then ordinary idempotent jobs, so a duplicate tick is harmless. Cron patterns run in `Asia/Colombo`.

### Process model

- The API process only **produces** jobs. The worker process registers processors, and on SIGTERM stops taking jobs, waits for active ones, then closes its connections.
- Producers fail fast: if Valkey is down, `add` rejects after a short timeout and the request returns an error rather than queueing in memory (a job held in a process that can die is lost).
- The Valkey connection is a readiness check (`valkey`) in the API's `/health/ready`; the worker has no HTTP surface and exits on startup failure.
- Tests run processors inline with `InlineJobProducer` (no Valkey); the `valkey` test project exercises the real queue and limiter.
- Rate limits share the Valkey connection ([C6](../plan/phase-2.md)): an atomic Lua fixed window, failing closed (503) when Valkey is down unless a rule opts out, which auth and OTP rules never do.

## Alternatives considered

- **pg-boss (Postgres queue).** Fewer moving parts, but puts queue churn on the primary database, and Valkey is already operated.
- **Cloud queues (SQS etc.).** Vendor lock-in and no local equivalent for the dev stack.
- **In-process timers.** Lost on restart, run on every node, no retries.

## Consequences

- A Valkey outage stops SMS and imports (they fail fast and the user retries). In production Valkey needs persistence (`appendonly yes`) and monitoring; that is a deploy concern, not the dev stack's.
- Every new job type needs a queue entry, a payload schema, an idempotent processor and a test that runs it inline.
- New dependencies: `bullmq` (queues, workers, schedulers) and `ioredis` (its connection, also used by the rate limiter).
