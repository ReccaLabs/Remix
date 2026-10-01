# 05 · Roadmap — phases, milestones, risks, decisions

> Part of the [ReMix development plan](README.md). Each phase delivers a **working, demoable slice on staging** with explicit exit criteria. A phase is closed only when its exit criteria and the phase Definition of Done ([04-quality.md §3.3](04-quality.md#33-phase)) are met. This supersedes the phase table in DEVELOPMENT.md §4.

Estimates assume 2–3 full-stack developers with AI assistants (see [01-product.md §5](01-product.md#5-assumptions-and-constraints)). They are estimates, re-planned at the end of every phase.

---

## 1. Timeline overview

```
Weeks:   1───4   5──7   8───11  12─14  15─17  18─20  21─23  24───27  28───31   32──────40   41+
Phase:   [ 1 ]  [ 2 ]  [  3  ] [ 4 ]  [ 5 ]  [ 6 ]  [ 7 ]  [  8   ] [pilot ]   [   9   ]   [10]
         Found. People Money   Learn  Live   Site+  Platf. Harden+   R1 live  GA (R2)    Growth
         +skel  +class                +att   msgs   +bill  launch    1 month              (R3)
                                                           ▲R1 gate            ▲R2 gate
Parallel from week 1: legal (PDPA) · Zoom Marketplace review · PayHere pilot merchants ·
                      Text.lk sender IDs · pilot recruitment · si/ta translators · missing designs
```

| Milestone | Week (est.) | Meaning |
| --- | --- | --- |
| M0 ✅ | done | remix.lk live-ready (Phase 0) |
| M1 Walking skeleton | 4 | A student of a seeded tenant logs in on its subdomain and sees their class — through web → api → RLS DB, deployed to staging |
| M2 First money | 11 | Card + slip + cash payments unlock months end to end on staging |
| M3 Teach & learn | 17 | Protected lessons and Zoom live classes with attendance work end to end |
| M4 Feature-complete R1 | 23 | All R1 Musts done; platform admin + billing work |
| **M5 R1 Pilot launch** | 27 | 3 pilot institutes live in production |
| M6 Pilot month closed | 31 | One full fee cycle run by pilots; feedback triaged |
| **M7 R2 GA** | 40 | Open for paying institutes |

---

## 2. Phases

### Phase 0 — remix.lk ✅ (done)

Marketing site, demo/trial form, security headers, CI. **Remaining before public launch:** D1 database + Turnstile keys + Resend, lawyer review of legal pages, Cloudflare Pages deploy, Lighthouse ≥ 95 check on production.

---

### Phase 1 — Foundation & walking skeleton (weeks 1–4)

**Goal:** the platform's spine, with isolation proven, auth decided and the deploy pipeline working.

| Track | Deliverables |
| --- | --- |
| Monorepo | `apps/web` (Next.js 16), `apps/api` (NestJS + worker entry), `packages/db` (Drizzle), typed API client in `packages/types` |
| Local stack | `infra/docker/compose.yaml`: Postgres 18, Valkey, Mailpit, MinIO (R2 stand-in), provider mock server |
| Database | DB roles (`remix_owner/app/platform/readonly`), `app_tenant_id()`, RLS policy template, `withTenant()`, migration runner, deterministic seed (Kamal Physics, 2,000 students) |
| Isolation | Generated isolation test suite + CI check "every tenant table has tenant_id + RLS" |
| Tenancy | Host → tenant resolution (proxy + API), `*.localhost` dev hosts, tenant status handling (TEN-01/02/06) |
| Auth spike | Better Auth evaluation against the requirements → **ADR 0004**; then student phone+password login, staff login, sessions table, devices table, logout (AUTH-01/05 basic) |
| UI | `packages/ui`: AppShell, PortalShell, PlatformShell, Button, Input, PhoneInput, DataTable v1, StatCard, StatusBadge, EmptyState, Skeleton, Toast, ConfirmDialog |
| API conventions | Problem+json errors, Zod pipe, OpenAPI generation, idempotency middleware, request/tenant logging context |
| Providers | Interfaces + in-memory mocks for Payment, SMS, Video, Meeting, Storage, Email |
| Ops | Staging server on Hetzner, Kamal deploy, Sentry in all apps, structured logs, `/health`, CI: Testcontainers, isolation suite, Playwright smoke, Trivy, bundle-size check |
| Platform | CLI `pnpm tenant:create` (slug, name, plan, owner phone) until the platform UI exists |

**Exit criteria (M1):**
- [ ] On staging, `kamal.staging.remix.lk` serves the portal; a seeded student logs in and sees their classes list from the API
- [ ] Isolation suite green for all tables; a deliberately broken policy makes CI fail (verified once)
- [ ] ADRs 0003–0005, 0010, 0012 accepted
- [ ] One-command local setup documented (`pnpm dev` brings up everything)

---

### Phase 2 — People & classes (weeks 5–7)

**Goal:** institutes can load their students and classes; students manage their own account.

**Scope:** AUTH-02/03/04/07/08/09 · STF-01/02/03 · STU-01..05, STU-07 · CLS-01..06 · PAR-01, PAR-03 · DAT-01 · TEN-03 · admin dashboard skeleton (real counts) · portal Home/Classes/Me shells.

**Exit criteria:**
- [ ] Owner imports 500 students from CSV with validation preview (J-08)
- [ ] 2-device limit flow works end to end (J-01); admin can sign out devices
- [ ] Staff invite + 2-step for owner/cashier; teacher sees only own classes (permission tests)
- [ ] Classes CRUD with schedules; timetable feeds dashboard "Today's classes"
- [ ] Tenant theme colour/logo applied to portal and admin

---

### Phase 3 — Money (weeks 8–11)

**Goal:** fees collected three ways, all landing in one ledger, unlocking access correctly. *The highest-risk phase — money correctness.*

**Scope:** FEE-01..12 · SET-02/03 · MSG-01/02/04 (receipts, slip results, reminders, OTP) · SMS wallet basics · student Pay screens · admin Fees tabs · receipts PDF + thermal print layout.

**Exit criteria (M2):**
- [ ] J-02, J-03, J-04, J-05, J-09 green on staging with PayHere **sandbox** and Text.lk test sender
- [ ] Ledger property tests: random sequences of payments/reversals never produce a paid line without allocations ≥ amount
- [ ] Monthly invoice job is idempotent (run twice → no duplicates) and handles 50 tenants in < 5 min
- [ ] Cashier usability test: ≥ 3 slips/minute with keyboard only; cash counter < 30 s per student
- [ ] Two-reviewer security review of PayHere notify + slip flows done

---

### Phase 4 — Learning (weeks 12–14)

**Goal:** protected lessons that only paid students can watch, usable on a cheap phone.

**Scope:** LES-01..09, LES-11 · R2 storage provider with signed URLs, upload pipeline (magic bytes, EXIF strip) · portal class page, player, continue watching · LES-10 if time.

**Exit criteria:**
- [ ] J-06 green with real Bunny in staging (test library) and token auth + referrer lock on
- [ ] Unpaid student cannot obtain a playback token or tute URL via API (J-05 extended)
- [ ] Player works at 360 px on a low-end Android over throttled 3G (manual test recorded)
- [ ] Usage (GB delivered) tracked per tenant per day

---

### Phase 5 — Live classes & attendance (weeks 15–17)

**Goal:** Zoom classes with locked names and automatic attendance; parents told about absences.

**Scope:** LIV-01..07, LIV-09 · ATT-01..03 · MSG absence SMS · LIV-08 and ATT-04 if time.

**Dependency:** Zoom Marketplace app approved (submitted in week 1). Fallback: development-mode app limited to pilot accounts.

**Exit criteria (M3):**
- [ ] J-07 green against a real Zoom test account in staging
- [ ] Registrants added automatically when a student pays before class start
- [ ] Attendance statuses (present/late/left early/absent) correct against a recorded webhook fixture set
- [ ] Token refresh + disconnect + deauthorization handled

---

### Phase 6 — Institute website, messages, reports (weeks 18–20)

**Goal:** every institute has a public site on day 1 and can communicate with students and parents.

**Scope:** WEB-01/02/04 · MSG-03, MSG-06, MSG-07 · RPT-01/02 · SET-01, SET-04..08 · admin mobile layouts completed (17a/17b etc.).

**Exit criteria:**
- [ ] J-14 green; public site Lighthouse mobile ≥ 90 with real tenant data
- [ ] SMS compose shows segment count + cost before sending; wallet debits are atomic with enqueue
- [ ] Income and unpaid reports match ledger totals (reconciliation test)

---

### Phase 7 — Platform admin & ReMix billing (weeks 21–23)

**Goal:** Recca Labs can run the business: onboard, support, bill, suspend.

**Scope:** PLT-01..04, PLT-06/07 · BIL-01..05 · TEN-05 feature flags UI · AUTH-06 platform SSO + TOTP/WebAuthn · trial lifecycle emails.

**Exit criteria (M4):**
- [ ] J-10, J-11, J-13 green
- [ ] Metering cross-checked: active students counted by payment or login, matched against a hand-computed fixture
- [ ] Dunning: past-due → suspend → reactivate verified with time-travel tests
- [ ] All R1 Musts in [01-product.md §4.2](01-product.md#42-moscow-for-r1-pilot-mvp) are Done

---

### Phase 8 — Hardening & R1 pilot launch (weeks 24–27)

**Goal:** production-grade and three real institutes live.

| Track | Work |
| --- | --- |
| Reliability | Production HA Postgres + standby, PgBouncer, WAL archiving offsite, restore drill, failover test |
| Performance | k6 Saturday scenario on production-like infra; fix hotspots; cache tenant lookups/public sites |
| Security | DEVELOPMENT.md §5 Musts 100%; ZAP + manual review / pen test; secrets rotation; staff 2FA audit |
| Legal | PDPA review, DPA signed by pilots, consent capture live, privacy/terms final |
| Language | si/ta student-portal strings reviewed by native speakers; pseudo-locale layout fixes |
| Accessibility | axe clean + manual screen-reader pass on portal and core admin |
| Support | Runbooks, on-call rota, status page, incident plan, help-centre articles (English) |
| Onboarding | Migrate pilot data with DAT-01, train owners/cashiers on site, Saturday on-site support for the first two weeks |

**Exit criteria (M5 — R1 gate):** release Definition of Done ([04-quality.md §3.4](04-quality.md#34-release-r1-pilot-r2-ga)) + production readiness review signed off.

**Pilot month (weeks 28–31):** weekly check-ins, cashier shadowing on Saturdays, bug SLA (P1 4 h, P2 2 days), metric tracking vs [01-product.md §1](01-product.md#success-metrics-what-we-measure-after-pilots).

---

### Phase 9 — General availability, R2 (weeks 32–40)

**Scope:** TEN-04 custom domains · WEB-03 page builder (Puck) · WEB-05 + STU-08 online enrolment · PAR-02 parent view · MSG-05 own SMS gateway · LES-12 own Bunny · FEE-13 OCR assist · FEE-14 reconciliation · RPT-03/04 · ATT-05 · BIL-03 card billing + BIL-06 proration · PLT-05/08/09 · DAT-04 · si/ta admin UI · self-serve trial signup from remix.lk (lead → tenant) · pen test.

**Exit criteria (M7 — R2 gate):** release DoD; pilots renewed as paying customers; ≥ 5 new institutes onboarded with < 15 min staff effort each (N-PST-1).

---

### Phase 10 — Growth, R3 (week 41+)

Prioritised by pilot/customer demand and revenue: ReMix+ gate app (GTE, offline, NFC) · student/parent mobile app (Expo) · white-label app · exams & results (marks, report cards) · multi-branch (Enterprise) · hardware DRM add-on · analytics for owners · cells (multi-region scale-out) when capacity requires.

---

## 3. Parallel long-lead tracks (start week 1)

| Track | Why it's long | Owner | Needed by |
| --- | --- | --- | --- |
| PDPA legal review + DPA template | Lawyer availability, minors' consent rules | Founder | Phase 8 |
| Zoom Marketplace app submission | Review takes weeks; scopes must be justified | Lead dev | Phase 5 |
| PayHere merchant accounts for pilots | Each institute applies with its own documents | Sales + pilots | Phase 3 (sandbox) / Phase 8 (live) |
| Text.lk account + sender ID registration per institute | Telco approval per sender ID | Ops | Phase 3 |
| Bunny Stream account, test + prod libraries | Quick, but billing setup | Lead dev | Phase 4 |
| Pilot institute recruitment (3) | Trust building, schedules | Founder/sales | Phase 8 |
| Native si/ta translators/reviewers | Availability | Founder | Phase 8 |
| Missing designs (§4) | Design capacity | Designer | One phase before build |

---

## 4. Design gaps (screens not yet designed)

The Claude Design files cover the core flows. These are needed before their phase starts:

| Screen | Needed by |
| --- | --- |
| Settings → General, Staff and roles (invite, roles, 2FA status), Receipts template | Phase 2/3 |
| Import wizard (mapping, preview, errors) | Phase 2 |
| Student first-login / set password; staff invite acceptance | Phase 2 |
| Receipt print layout (80 mm thermal) and PDF receipt | Phase 3 |
| Messages: compose, recipients, cost preview, history | Phase 6 |
| Attendance: manual marking (tablet), absent list | Phase 5 |
| Reports: income, unpaid, attendance | Phase 6 |
| Website settings (R1 template), page builder + domain flow (R2) | Phase 6 / 9 |
| Settings → Subscription & ReMix invoices; trial banner; suspended states | Phase 7 |
| Platform: Billing, Usage, Support, System health, Staff | Phase 7 |
| Parent view; online enrolment flow | Phase 9 |
| Global: empty/loading/error states, permission denied, 404/500 for tenant sites, impersonation banner | Phase 1–2 |
| Sinhala variants of student Home/Pay/Classes to check text length | Phase 8 |

---

## 5. Risk register

| # | Risk | Likelihood | Impact | Mitigation | Owner |
| --- | --- | --- | --- | --- | --- |
| R1 | Zoom app review delayed or scopes rejected | Med | High | Submit week 1; dev-mode app for pilots; graceful "Zoom not available" path | Lead dev |
| R2 | Better Auth doesn't fit tenant-scoped phone auth | Med | Med | Time-boxed spike in Phase 1; fallback design already specified | Lead dev |
| R3 | Money bug (wrong unlock, double charge) | Low | Critical | Ledger model, property tests, idempotency, two-reviewer rule, reconciliation | Dev team |
| R4 | Tenant data leak | Low | Critical | RLS + isolation suite + pen test | Dev team |
| R5 | Saturday peak overload | Med | High | k6 before releases, horizontal app nodes, cached tenant lookup, video off-loaded to Bunny | Ops |
| R6 | Video/SMS costs exceed plan margins | Med | Med | Usage metering from day 1, allowances, alerts, pricing review after pilots | Founder |
| R7 | SMS OTP fraud | Med | Med | Quotas, Turnstile, +947 only, spend alerts | Dev team |
| R8 | Scope creep from pilots | High | Med | MoSCoW, R2/R3 backlog, change control at phase boundaries | Founder |
| R9 | Small team / bus factor | High | High | ADRs, CLAUDE.md, knowledge graph, pairing on money/auth, runbooks | Everyone |
| R10 | Cashiers resist changing habits | Med | High | Keyboard-first slip queue, on-site training, Saturday support | Sales |
| R11 | Low-end devices struggle | Med | Med | Budgets in CI, real-device testing, 360p default on slow networks | Dev team |
| R12 | PDPA requirements change scope (consent, residency) | Med | Med | Lawyer early; data minimisation; EU hosting clause | Founder |
| R13 | PayHere outage or API change | Low | High | Slip + cash fallback always available; status alerts | Ops |
| R14 | Translation quality | Med | Med | Native reviewers; English fallback; locale goes live only when reviewed | Founder |

---

## 6. Decision backlog (ADRs)

Write each ADR before the phase that depends on it. Existing: [0001](../decisions/0001-monorepo-and-static-marketing-site.md), [0002](../decisions/0002-i18n-strategy.md).

| ADR | Decision | Needed by |
| --- | --- | --- |
| 0003 | Same-origin `/api/v1` on every host via edge proxy (vs `api.remix.lk` + CORS) | Phase 1 |
| 0004 | Better Auth vs own auth (sessions, devices, OTP, tenant scope) | Phase 1 |
| 0005 | Tenancy: shared schema + RLS, DB roles, `withTenant`, platform cross-tenant access | Phase 1 |
| 0006 | Next.js ↔ API data access: server-side typed client; no direct DB access from web | Phase 1 |
| 0007 | IDs (UUIDv7), timestamps, money (cents), numbering sequences | Phase 1 |
| 0008 | Payment ledger: invoices, allocations, derived status, reversals | Phase 3 |
| 0009 | File storage: R2 private buckets, presigned uploads, scanning, retention | Phase 3 |
| 0010 | Video: Bunny Stream with token auth + watermark; YouTube free previews | Phase 4 |
| 0011 | Zoom integration model (user OAuth app, registrants, webhooks) | Phase 5 |
| 0012 | Jobs & scheduling: BullMQ, cron locks, idempotency | Phase 1 |
| 0013 | Observability stack (Sentry + OTel + Grafana/Loki or Better Stack) | Phase 1 |
| 0014 | Postgres HA: Patroni self-hosted vs managed provider | Phase 8 |
| 0015 | Impersonation policy (30 min, reason, owner email, banner) — supersedes DEVELOPMENT.md 60 min | Phase 7 |
| 0016 | Custom domains via Cloudflare for SaaS | Phase 9 |
| 0017 | Page builder (Puck) data model and sanitisation | Phase 9 |

---

## 7. How work is sliced and parallelised

- **Vertical slices.** Each story crosses DB → API → UI → tests for one behaviour (e.g. "cashier approves a slip"), not "build all tables first".
- **Module ownership per developer/agent** within a phase (e.g. one on `fees` API, one on Fees UI, one on tests/E2E), with contracts (Zod schemas) agreed first in `packages/types` so work proceeds in parallel.
- **AI agents** get a self-contained brief: feature IDs, design screen, files they own, acceptance criteria, and the verification commands. They never edit shared files outside their brief; shared changes go through the lead. Query the knowledge graph (`/graphify query`) before changing unfamiliar areas and run `/graphify --update` after a feature lands.
- **Phase boundary ritual:** demo on staging → exit criteria checklist → retro → update this roadmap (dates, scope) and feature statuses in [README.md](README.md).
