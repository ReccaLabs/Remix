# 03 · Architecture

> Part of the [ReMix development plan](README.md). The target technical design for the LMS platform (`apps/web`, `apps/api`, `packages/db`). The marketing site's architecture is already in [ADR 0001](../decisions/0001-monorepo-and-static-marketing-site.md). Decisions marked **ADR-needed** are listed in [05-roadmap.md §6](05-roadmap.md#6-decision-backlog-adrs).

---

## 1. Principles

1. **Modular monolith.** One NestJS API with strict module boundaries, one Next.js web app, one worker process from the same codebase. No microservices until a module has a proven independent scaling need.
2. **Isolation in the database, not just the code.** Postgres Row Level Security on every tenant table; the app role is not the table owner. Code bugs can't leak another institute's data.
3. **One source of truth per concept.** Zod schemas and domain logic in `packages/types`, DB schema in `packages/db`, tokens in `packages/ui`. Never duplicate prices, enums or validation.
4. **Money and access are derived, not edited.** "Paid" comes from the payment ledger; "can watch" comes from the unlock rule. No status flags set by hand.
5. **Slow work is async.** SMS, PDFs, webhooks, imports, encoding callbacks → BullMQ. Requests return in < 300 ms p95.
6. **Integrations behind interfaces.** `PaymentProvider`, `SmsProvider`, `VideoProvider`, `MeetingProvider`, `StorageProvider`, `EmailProvider`. Swappable and mockable in tests.
7. **Boring, cheap, reliable.** Hetzner + Cloudflare + Postgres; scale by adding app nodes, then by cells of ~50 institutes.

---

## 2. System context

```
                         ┌──────────────────────── Cloudflare ────────────────────────┐
                         │ DNS · TLS (incl. custom hostnames) · WAF · rate limits · cache │
                         └───────┬───────────────────────┬──────────────────────┬─────┘
                                 │                       │                      │
                  remix.lk (Pages, static)   <slug>.remix.lk / custom domain   admin.remix.lk
                  apps/site  ✅               apps/web (tenant area)            apps/web (platform area)
                                 │                       │                      │
                                 │        same-origin /api/v1/* on every host   │
                                 │                       ▼                      │
                                 │       ┌──────── Hetzner private network ─────┴────────┐
                                 │       │  edge proxy (Kamal proxy) → web (Next.js) ×2+   │
                                 │       │                         → api (NestJS)  ×2+     │
                                 │       │  worker (BullMQ)  ·  Valkey  ·  PostgreSQL 18   │
                                 │       │                              primary + standby  │
                                 │       └────────────────────────────────────────────────┘
                                 │
   External: PayHere (each institute's merchant) · Bunny Stream · Cloudflare R2 · Zoom · Text.lk · Resend · Sentry
```

### Containers

| Container | Tech | Responsibility |
| --- | --- | --- |
| `apps/site` ✅ | Next.js static on Cloudflare Pages + Pages Functions + D1 | Sales site, lead capture |
| `apps/web` | Next.js 16 App Router, RSC, Tailwind v4, `@remix/ui`, TanStack Query (client islands), react-hook-form + Zod | Tenant public site, student portal, institute admin, platform admin. Server-renders pages by calling the API server-side with the user's cookie |
| `apps/api` | NestJS, Drizzle, Zod pipes, own auth ([ADR 0004](../decisions/0004-own-authentication.md)) | REST API `/api/v1`, auth, webhooks, business rules, RLS context |
| worker | Same NestJS codebase, `WORKER=1` entry | BullMQ processors and schedulers (cron) |
| `packages/db` | Drizzle schema + SQL migrations + RLS policies + `withTenant()` | Single schema source; migrations run by CI/deploy, never by the app at boot |
| `packages/types` ✅ | Zod + domain functions | Shared contracts: DTOs, enums, pricing, money, phone |
| `packages/ui` ✅ | Tailwind tokens + React primitives (grows into shadcn/ui-based app components) | One design system for all apps |
| `apps/gate` (R3) | Expo (React Native) | Offline gate scanning |

### Same-origin API (**ADR-needed**)

The browser always calls `/api/v1/*` **on the host it's on** (e.g. `kamalphysics.remix.lk/api/v1/...`). The edge proxy routes that path to `apps/api`. Why:

- Auth cookies stay **host-only** (no `Domain=.remix.lk`), so a compromised tenant subdomain can't read other tenants' cookies, and custom domains work identically.
- No CORS with credentials, no third-party-cookie problems on Safari/iOS.
- The API derives the tenant from the `Host` header (forwarded by the proxy) and cross-checks it against the session's tenant.

---

## 3. Multi-tenancy

| Concern | Design |
| --- | --- |
| Model | Shared database, shared schema, `tenant_id uuid not null` on every tenant table |
| Resolution | `Host` → `tenant_domains` lookup (cached in Valkey 60 s, key `host:<host>`) → `tenant_id`. Unknown/unverified host → 404 |
| Enforcement | `withTenant(tenantId, tx => …)` opens a transaction and runs `SET LOCAL app.tenant_id = $1`. RLS policy on each table: `tenant_id = app_tenant_id()`; `app_tenant_id()` returns NULL when unset → zero rows |
| DB roles | `remix_owner` (migrations, owns tables), `remix_app` (API, RLS enforced, `NOBYPASSRLS`), `remix_platform` (platform staff queries, explicit cross-tenant views only), `remix_readonly` (reporting/backups) |
| Platform queries | Cross-tenant reads only through dedicated SQL views/functions owned by `remix_owner` and granted only to `remix_platform` (a view owned by an RLS-bound role would see zero rows), used by the `platform` module. Never by turning RLS off ([ADR 0005](../decisions/0005-tenancy-shared-schema-rls.md)) |
| Cache keys | Always prefixed `t:<tenantId>:` |
| Files | Object keys prefixed `<tenantId>/…`; signed URL issuance checks tenant |
| Custom domains | Cloudflare for SaaS custom hostnames (TLS automated); verification by CNAME to `domains.remix.lk` + TXT token (**ADR-needed**) |
| Scale-out | **Cells**: when one DB pair nears limits (~50 institutes / ~20k active students), new tenants go to a new cell (app + DB pair); a global `tenant → cell` routing table at the edge |

**Isolation test harness (mandatory, Phase 1):** for every table with `tenant_id`, an automated test creates data in tenants A and B and asserts that queries in A's context return none of B's rows and that inserts with B's id fail. A CI check fails if a new table lacks `tenant_id` + RLS (allow-list for global tables).

---

## 4. Identity & access

| Topic | Design |
| --- | --- |
| Library | Own implementation — decided in [ADR 0004](../decisions/0004-own-authentication.md) after evaluating Better Auth against per-tenant phone identities, RLS-scoped sessions/devices and the 2-device rule |
| Identities | `tenant_users` (students + institute staff, unique `(tenant_id, phone)`), `platform_staff` (separate table, separate login, Google SSO) |
| Passwords | Argon2id (m=19 MiB, t=2, p=1 — OWASP), min 8 chars, breached/common-password check (k-anonymity list, offline) |
| Sessions | DB-backed session rows; opaque 256-bit token (SHA-256 hash stored) in a host-only `__Host-` `HttpOnly; Secure; SameSite=Lax` cookie; rotated at most every 15 min via `POST /auth/session/refresh` called from `proxy.ts`; reuse of a rotated token revokes the family; 12 h / 30 days absolute ([ADR 0004](../decisions/0004-own-authentication.md)) |
| Devices | `devices` table: id (random cookie), label (parsed UA), first/last seen, last IP country/city (approx.), signed_out_at/by. 2 active per student; 3rd login returns `409 DEVICE_LIMIT` with the device list |
| 2-step | SMS OTP for owner/admin/cashier (trusted device 30 days); TOTP/WebAuthn for platform staff |
| Authorization | NestJS guards: `@Roles()` + resource scope (teacher → own classes); policies duplicated in RLS for defence in depth |
| CSRF | SameSite=Lax + `Origin` / `Sec-Fetch-Site` verification + JSON-only bodies on every state-changing request — Lax alone is not enough because all `*.remix.lk` hosts are same-site ([ADR 0003](../decisions/0003-same-origin-api-via-edge-proxy.md)) |
| Impersonation | Platform staff mint a time-boxed (30 min) tenant session flagged `impersonated_by`, reason stored, owner emailed, banner rendered from the flag, every request audit-logged |

---

## 5. Domain model (core tables)

All tenant tables carry `tenant_id`, `created_at`, `updated_at`; ids are UUIDv7 (sortable). Money columns are `bigint` cents. Times are `timestamptz` (UTC).

```
tenants ─┬─ tenant_domains (host, verified_at, primary, ssl_status)
         ├─ tenant_settings (theme, receipt template, notification prefs, bank details)
         ├─ tenant_features (flag, enabled, source: plan|override)
         ├─ tenant_integrations (kind: payhere|zoom|sms|bunny, config jsonb, secret_ciphertext, key_id)
         │
         ├─ tenant_users (kind: student|staff, phone, email, password_hash, status, locale)
         │    ├─ staff_roles (role, class_scope[])
         │    ├─ students (student_no, school, al_year, medium, archived_at, card_token)
         │    │    └─ student_guardians ── guardians (name, relation, phone, sms_prefs, consent_at)
         │    ├─ sessions · devices · otp_challenges
         │
         ├─ halls ── classes (name, grade, medium, teacher_id, fee_cents, place, hall_id, starts_on)
         │              ├─ class_schedules (weekday, start, duration, rrule) · class_sessions (date, status, kind)
         │              └─ enrollments (student_id, from_month, to_month, fee_override_cents, reason)
         │
         ├─ invoices (number, student_id, month, due_on, status*) ── invoice_lines (enrollment_id, month, amount_cents)
         ├─ payments (method: card|slip|cash|manual|reversal, amount_cents, provider_ref, received_by)
         │    └─ payment_allocations (payment_id, invoice_line_id, amount_cents)
         ├─ bank_slips (file_key, amount_cents, reference, slip_date, status, ocr jsonb, reviewed_by, reason)
         ├─ receipts (number, payment_id, pdf_key)
         ├─ provider_events (provider, event_id UNIQUE, payload, processed_at)   ← webhook inbox / idempotency
         │
         ├─ lessons (class_id, month, title, notes, source: bunny|youtube|pdf, status, release_at, access)
         │    ├─ lesson_assets (bunny_video_id | youtube_id | file_key, duration, size)
         │    └─ lesson_progress (student_id, position_s, completed_at) · lesson_views
         ├─ live_sessions (class_session_id, zoom_meeting_id, join_opens_at, recording_lesson_id)
         │    └─ live_registrants (student_id, registrant_id, join_url_ciphertext)
         ├─ attendance (class_session_id, student_id, source, status, joined_at, seconds_present)
         │
         ├─ announcements · sms_messages (status, segments, cost) · sms_wallet_ledger
         ├─ website_pages (draft jsonb, published jsonb) · website_assets
         ├─ audit_logs (actor, actor_kind, impersonated_by, action, entity, before, after, ip)
         └─ usage_daily (active_students, video_gb, storage_gb, sms_sent)

platform (no tenant_id): platform_staff · platform_sessions · plans (mirrors @remix/types) ·
  subscriptions · platform_invoices · impersonation_sessions · platform_audit_logs · leads
```

`*` invoice status is a cached projection of allocations, recomputed in the same transaction as any allocation change; a nightly job verifies projections match the ledger.

---

## 6. API design

| Topic | Convention |
| --- | --- |
| Style | REST, `/api/v1/<resource>`; plural nouns; actions as sub-resources (`POST /bank-slips/:id/approve`) |
| Contracts | Request/response Zod schemas in `packages/types/src/api/*`; NestJS `ZodValidationPipe`; `z.strictObject` rejects unknown fields; OpenAPI generated from the schemas for docs and the typed client |
| Client | Typed client (`createApiClient`) driven by the endpoint registry in `packages/types/src/api/routes.ts`, used by `apps/web` server components and client islands ([ADR 0006](../decisions/0006-web-api-data-access.md)) |
| Errors | RFC 9457 `application/problem+json`: `{ type, title, status, code, errors? }`; stable `code`s (`DEVICE_LIMIT`, `MONTH_LOCKED`, `PLAN_LIMIT`, …); never stack traces |
| Pagination | Cursor-based (`?cursor=&limit=`, max 100) |
| Idempotency | `Idempotency-Key` header required on payment-creating and SMS-sending endpoints; stored 24 h |
| Webhooks | `/api/v1/webhooks/{payhere,zoom,bunny,textlk}` — signature check, timestamp/replay window, insert into `provider_events` (unique event id) then enqueue; respond 200 fast |
| Rate limits | Cloudflare WAF rules for login/OTP/payment paths + per-tenant/per-user limits in Valkey |
| Versioning | Additive changes only within v1; breaking → v2 path, run both during migration |

---

## 7. Integrations

| Provider | Interface | Key flows | Safety |
| --- | --- | --- | --- |
| **PayHere** (institute's merchant) | `PaymentProvider` | Build checkout (hash with merchant secret) → redirect → `notify_url` → verify `md5sig`, amount, currency, order → allocate → unlock → receipt | Server-to-server only; idempotent on payment_id; sandbox per tenant; daily reconciliation (R2) |
| **Bunny Stream** | `VideoProvider` | Create video → TUS upload credentials (signed, 1 h) → encode webhook → Ready; playback token (≤ 2 h) | Token auth, referrer allow-list per tenant hosts, MediaCage Basic, per-tenant collection |
| **YouTube** | `VideoProvider` (unlisted embed) | Validate URL → store id → privacy-enhanced embed (`youtube-nocookie.com`) | Labelled unprotected; free previews only |
| **Cloudflare R2** | `StorageProvider` | Slips, tutes, receipts, logos; presigned PUT for uploads with content-type + size conditions | Private buckets, `<tenantId>/` prefixes, signed GET ≤ 10 min, magic-byte check + EXIF strip in worker, ClamAV scan (Should) |
| **Zoom** | `MeetingProvider` | OAuth (user-managed app) → create recurring meeting with registration + name lock settings → add registrants for paid students → webhooks participant_joined/left, recording.completed → attendance + recording import | Tokens encrypted; refresh server-side; deauth webhook; Marketplace review started in Phase 1 |
| **Text.lk** | `SmsProvider` | Send (unicode aware), DLR webhook, balance check | Wallet debit in same tx as enqueue; SMS-pumping limits |
| **BYO SMS gateway** (R2) | `SmsProvider` | Generic HTTP adapter (method, URL template, auth header) | SSRF guard: https only, DNS-resolve to public IPs (block RFC1918, loopback, link-local, ULA), no redirects, 5 s timeout, response size cap |
| **Resend** | `EmailProvider` | Staff invites, impersonation notices, platform invoices | SPF/DKIM/DMARC on remix.lk |

---

## 8. Background jobs (BullMQ queues)

| Queue | Jobs | Retry/backoff |
| --- | --- | --- |
| `sms` | send, DLR update | 5× exponential; dead-letter + alert |
| `payments` | process PayHere notify, reconcile (R2) | idempotent; 10× |
| `media` | Bunny webhook → lesson Ready, recording import, PDF watermark, slip image normalise/OCR | 5× |
| `zoom` | create/update meetings, sync registrants (on payment), import attendance, refresh tokens | 5×; per-tenant concurrency 1 |
| `billing` | daily usage snapshot, cycle close → platform invoice, dunning steps | cron |
| `fees` | monthly invoice generation (1st, 00:05 Asia/Colombo), reminders | cron, idempotent per (tenant, month) |
| `imports` | CSV import validate/commit, tenant export bundle | 1× with resumable chunks |
| `email` | send via Resend | 5× |

Schedulers run in the worker with a Valkey lock so only one instance fires each cron. All jobs carry `tenantId` and run inside `withTenant`.

---

## 9. Frontend architecture (`apps/web`)

- **Routing by host** in `src/proxy.ts` (Next 16 middleware): `admin.remix.lk` → `(platform)`; tenant hosts → `(tenant)` with `(site)`, `(portal)`, `admin` groups (structure in [apps/web/README.md](../../apps/web/README.md)).
- **Server Components by default**; data fetched server-side via the typed API client forwarding the session cookie. Client islands (TanStack Query) only for interactive tables, queues, uploads, players.
- **Shells:** `PlatformShell` (dark sidebar), `AdminShell` (light sidebar + mobile bottom tabs: Home · Students · Fees · Classes · More), `PortalShell` (mobile bottom tabs: Home · Classes · Pay · Live · Me; desktop left sidebar).
- **Component library** grows in `packages/ui` following DESIGN.md §3.3 (DataTable, StatCard, StatusBadge, MoneyInput, PhoneInput, MonthPicker, FileDrop, ConfirmDialog, CommandPalette, ImpersonationBanner, VideoPlayer with watermark layer).
- **i18n:** next-intl, same namespace pattern as `apps/site`; per-user locale stored on `tenant_users.locale`.
- **Performance budgets:** student routes < 200 KB JS, LCP < 2.5 s on 4G mid-range Android; admin routes < 350 KB JS. Enforced in CI with a bundle-size check.
- **Tenant theming:** brand CSS variables injected on `<html>` from tenant settings (validated).

---

## 10. Infrastructure & operations

| Area | Design |
| --- | --- |
| Environments | local (Docker Compose: Postgres 18, Valkey, Mailpit, MinIO-as-R2, mock providers) · preview (site only) · staging (`staging.remix.lk`, 1 server, anonymised data) · production |
| Hosting | Hetzner Cloud (DE/FI), private network; Cloudflare in front; firewall allows 443 only from Cloudflare ranges; SSH via Tailscale |
| Deploy | Docker images (non-root, distroless/alpine), Trivy-scanned; **Kamal** zero-downtime deploys with `/health` checks; `kamal rollback` < 1 min |
| Database | Postgres 18 primary + streaming standby (Patroni or managed) before the first paying institute; PgBouncer (transaction pooling — `SET LOCAL` is transaction-scoped, compatible); continuous WAL archiving to another provider (pgBackRest/WAL-G), 14-day PITR |
| Migrations | Expand → migrate → contract; backward compatible across one release; run as a deploy step |
| Observability | Sentry (web, api, worker); OpenTelemetry traces → Grafana Tempo (or Better Stack); Prometheus metrics; Loki logs (JSON, PII-scrubbed, `tenantId` + `requestId` on every line); Uptime Kuma; status page |
| Alerts | 5xx spike, p95 > 500 ms, queue backlog > 5 min, DB replication lag > 30 s, disk > 80%, failed backup, SMS failure rate > 5%, PayHere notify errors |
| Capacity target | Per cell: 4,000 logins / 2 min; 2,000 concurrent video viewers (Bunny serves video, API only issues tokens); 50 slip approvals/min |
| Cost (from DEVELOPMENT.md §6) | Pilot ≈ €25/month; paying stage ≈ €80–110/month; video/SMS pass-through priced into plans |

### Reliability targets

| Item | Target |
| --- | --- |
| Availability (portal + admin) | 99.9% monthly; 99.95% on Saturdays 6 AM–10 PM |
| RPO / RTO | ≤ 5 min / ≤ 1 h |
| Deploy freeze | No deploys 6–9 PM weekdays or Saturday mornings |
| Restore drill | Monthly, recorded |
