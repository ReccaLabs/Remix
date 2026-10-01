# 04 · Quality — NFRs, Definition of Done, testing, security, release

> Part of the [ReMix development plan](README.md). This is the **contract for "done"**. A story, epic, phase or release is not finished until it meets the matching checklist below. CI enforces as much of it as possible; reviewers enforce the rest.

---

## 1. Non-functional requirements (measurable)

| Area | Requirement | How it's verified |
| --- | --- | --- |
| Performance — student | LCP < 2.5 s, INP < 200 ms on mid-range Android over 4G; < 200 KB JS per route | Lighthouse CI on preview, bundle-size check in CI |
| Performance — admin | Dashboard < 2 s TTFB+render with 2,000 students; tables paginate at 50 rows < 300 ms API | k6 + API timing assertions |
| API latency | p95 < 300 ms, p99 < 1 s (excluding uploads) | Prometheus SLO dashboard |
| Peak load | 4,000 logins in 2 min per cell with p95 < 800 ms, 0 errors | k6 "Saturday 8 AM" scenario before each release |
| Availability | 99.9% monthly (99.95% Saturdays) | Uptime Kuma + status page |
| Data durability | RPO ≤ 5 min, RTO ≤ 1 h | Monthly restore drill report |
| Security | OWASP ASVS L2 for auth, session, access control, input validation; DEVELOPMENT.md §5 "Must" items 100% | Checklist + ZAP + pen test before R1 |
| Privacy | PDPA No. 9 of 2022 compliant; guardian consent < 18; DPA with every institute | Lawyer sign-off |
| Accessibility | WCAG 2.2 AA; keyboard complete; touch targets ≥ 44 px | axe in Playwright on every page + manual screen-reader pass per release |
| i18n | 100% UI strings in message files; layouts survive +40% text length; si/ta reviewed by native speakers | Missing-key check + pseudo-locale E2E run |
| Browser support | Chrome/Android last 3 versions, Safari iOS 16+, Edge, Firefox ESR | Playwright projects |
| Observability | Every request has `requestId` + `tenantId`; errors in Sentry within 1 min | Synthetic error test in staging |
| Cost | Infra ≤ budget in DEVELOPMENT.md §6 at each stage | Monthly cost review |

---

## 2. Definition of Ready (before a story enters a sprint)

- [ ] Linked to a feature ID (`FEE-06`) and need ID (`N-CSH-1`)
- [ ] Design screen referenced (or "no UI"); states listed: empty / loading / error / permission-denied
- [ ] Acceptance criteria written (Given/When/Then or bullet list), including the unhappy paths
- [ ] API contract sketched (endpoint, Zod schema names, error codes)
- [ ] Data changes identified (new tables → RLS + isolation test planned)
- [ ] Security/privacy impact noted (PII? money? roles? third party?)
- [ ] Sized ≤ 3 days; larger work is split
- [ ] Dependencies (provider accounts, other stories) available

---

## 3. Definition of Done

### 3.1 Story / pull request

**Functionality**
- [ ] All acceptance criteria pass, including unhappy paths and permission-denied
- [ ] Empty, loading (skeleton), error states implemented as designed
- [ ] Matches the design at 390 / 768 / 1024 / 1440 (screenshots in the PR)

**Code**
- [ ] TypeScript strict, no `any`/`@ts-ignore` without a reason comment
- [ ] Input validated with Zod from `packages/types` (`strictObject`); output typed
- [ ] Tenant data accessed only via `withTenant()`; no raw SQL strings
- [ ] Money in cents via `formatLKR`; times stored UTC, shown Asia/Colombo
- [ ] Slow work in a queue, not the request
- [ ] Integrations only through provider interfaces
- [ ] No secrets in code, logs or error messages; PII not logged

**Tests**
- [ ] Unit tests for new logic (Vitest), integration tests for new endpoints (real Postgres)
- [ ] **New tenant table → RLS policy + isolation test** (CI fails otherwise)
- [ ] E2E updated if a critical journey (§4.3) changed
- [ ] `pnpm lint && pnpm typecheck && pnpm test && pnpm build` green in CI

**UX quality**
- [ ] All text in `messages/en/*.json` (si/ta keys added, may be pending review)
- [ ] Keyboard reachable, visible focus, labels, axe clean, ≥ 44 px targets on mobile
- [ ] Status shown with word + colour

**Ops & docs**
- [ ] Money/role/settings changes write `audit_logs`
- [ ] Metrics/logs for new background jobs; alert if it can fail silently
- [ ] Migration is backward compatible (expand → contract)
- [ ] Docs/ADR updated when behaviour or architecture changed; plan feature status updated
- [ ] Reviewed and approved by one other developer (two for auth, payments, RLS, crypto)

### 3.2 Feature / epic

- [ ] Every story Done; feature's acceptance criteria in [02-features.md](02-features.md) demonstrably met on staging
- [ ] Tested with realistic volume (seed: 1 tenant × 2,000 students × 6 classes × 12 months)
- [ ] Product walkthrough recorded; tried by one real teacher or cashier where it's a core flow
- [ ] Help-centre article / in-app hint written (English) for user-facing features
- [ ] Feature flag default decided per plan
- [ ] Knowledge graph refreshed (`/graphify` update) so future work sees the new structure

### 3.3 Phase

- [ ] All phase exit criteria in [05-roadmap.md](05-roadmap.md) met and demoed on staging
- [ ] No open P1/P2 bugs; P3s triaged with owners
- [ ] Security checklist items for the phase's scope done; threat model updated
- [ ] Load/perf numbers for the phase's flows recorded vs NFRs
- [ ] Retro held; plan and estimates updated

### 3.4 Release (R1 pilot, R2 GA)

- [ ] Phase DoD for all included phases
- [ ] **Production readiness review** (§7) signed off
- [ ] External pen test (or ZAP + manual review for R1) with all High/Critical fixed
- [ ] Restore drill passed within RTO; HA failover tested
- [ ] k6 Saturday scenario passed on production-like infra
- [ ] Legal: privacy policy, terms, DPA, consent flows approved by lawyer
- [ ] si/ta strings for student portal reviewed by native speakers
- [ ] Support runbooks, on-call rota, status page, incident plan ready
- [ ] Pilot institutes' data migrated and verified with the owner

---

## 4. Test strategy

### 4.1 Pyramid

| Layer | Tool | Scope | Runs |
| --- | --- | --- | --- |
| Unit | Vitest | Domain logic in `packages/types` and API services: pricing, unlock rule, allocation, invoice generation, numbering, device limit, phone/time formatting | Every PR |
| Integration | Vitest + Testcontainers (Postgres 18, Valkey) | API endpoints with real DB, RLS on, provider mocks | Every PR |
| **Tenant isolation** | Generated suite | For each tenant table: cross-tenant read/insert/update/delete blocked; for each endpoint: tenant A token on tenant B host → 404/403 | Every PR (must pass) |
| Contract | Zod schema snapshot + OpenAPI diff | Breaking API changes detected | Every PR |
| Provider contract | Recorded fixtures (PayHere notify, Zoom webhooks, Bunny webhooks, Text.lk DLR) + sandbox smoke | Signature verification, idempotency | PR (fixtures) + nightly (sandbox) |
| E2E | Playwright (Chromium, WebKit, Android emulation) | Critical journeys (§4.3) on seeded staging-like stack | PR (smoke subset) + nightly (full) |
| Accessibility | axe-core in Playwright | Every visited page | With E2E |
| Visual | Playwright screenshots at 390/1440 for key screens | Regressions in design | Nightly |
| Load | k6 | Saturday login spike, slip queue, video token issuance, invoice generation for 50 tenants | Before each release + monthly |
| Security | Semgrep, gitleaks, pnpm audit, Trivy, OWASP ZAP baseline (staging) | — | PR / nightly / pre-release |

### 4.2 Test data

- `packages/db/seed`: deterministic seed — Kamal Physics (2,000 students, 6 classes, 12 months of invoices/payments), a Tutor-plan tenant, a suspended tenant, platform staff. Sample names match the designs (Nimali Perera BR-1042…).
- Factories for every entity; no shared mutable fixtures between tests.
- Staging uses anonymised production snapshots only after pilots (names/phones replaced).

### 4.3 Critical user journeys (E2E — must always pass)

| ID | Journey | Needs |
| --- | --- | --- |
| J-01 | Student logs in on 3rd device → sees device list → signs one out → continues | N-STU-4, N-OWN-3 |
| J-02 | Student pays 2 months by card (PayHere sandbox) → notify → months unlock → receipt PDF | N-STU-2 |
| J-03 | Student uploads slip → cashier approves with **A** → student unlocked + SMS queued; reject path with reason | N-STU-2, N-CSH-1 |
| J-04 | Cashier cash counter: scan/search → 2 months → change → receipt printed + SMS | N-CSH-2 |
| J-05 | Unpaid student sees locked month, cannot fetch video token or Zoom join URL (API-level check) | N-OWN-3 |
| J-06 | Teacher uploads video (mock Bunny) → Processing → Ready → paid student watches with watermark; resume position | N-TCH-1, N-STU-3 |
| J-07 | Owner connects Zoom (mock) → schedules weekly class → paid students registered → student joins with locked name → attendance imported | N-OWN-4, N-STU-1 |
| J-08 | Owner imports 500 students from CSV with 3 bad rows → preview → commit → error file | N-OWN-2 |
| J-09 | Monthly invoice generation on the 1st → reminders → overdue filter → "send reminder SMS" with cost preview | N-OWN-6 |
| J-10 | Platform staff creates tenant → owner invite → owner logs in with 2-step → trial active | N-PST-1 |
| J-11 | Platform staff logs in as admin with reason → banner → audit entry + owner email → session expires at 30 min | N-PST-2 |
| J-12 | Tenant A staff cannot see tenant B data via any UI route or API (host swap, id guessing) | N-OWN-7 |
| J-13 | Billing cycle close → active students counted (payment or login) → platform invoice correct per `monthlyPrice` | N-PST-3 |
| J-14 | Visitor opens institute public site on mobile → classes, timetable, contact visible; "Student login" works | N-VIS-1 |

---

## 5. Security plan

DEVELOPMENT.md §5 is the full control checklist. This section adds the **threat model**: what attackers want here and how we stop them.

| # | Threat / abuse case | Impact | Controls | Test |
| --- | --- | --- | --- | --- |
| T1 | Tenant data leak (bug or IDOR) | Critical | RLS everywhere, host↔session tenant cross-check, UUIDv7 ids, isolation suite | J-12, isolation suite |
| T2 | Account sharing between students | Revenue | 2-device limit, device list, Zoom name lock + unique registrant URLs, watermark | J-01 |
| T3 | Video piracy (screen record, download) | Revenue | Token auth, referrer lock, MediaCage, moving watermark → traceability; hardware DRM add-on (R3) | Manual + player test |
| T4 | Fake "paid" (forged PayHere redirect/notify, replay) | Money | md5sig verify with merchant secret, amount/order match, idempotent provider_events, never trust redirect | Provider contract tests |
| T5 | Fake or reused bank slip | Money | Duplicate reference detection, amount check, cashier review, audit | J-03 |
| T6 | Credential stuffing / brute force on phone logins | Accounts | Rate limits (WAF + app), lockout + SMS unlock, breached-password check, Turnstile after failures | k6 abuse test |
| T7 | SMS pumping / OTP toll fraud | Cost | OTP only to +947 numbers, per-phone/IP/tenant quotas, Turnstile on OTP request, spend alerts | Unit + alert test |
| T8 | Staff insider misuse (cashier reverses payments) | Money | Role limits (reversal owner-only), audit logs, daily summary email to owner | Permission tests |
| T9 | Platform staff abuse | Trust | SSO + TOTP/WebAuthn, impersonation reason + 30 min + owner email + banner, platform audit log | J-11 |
| T10 | SSRF via BYO SMS gateway | Infra | URL allow-rules, DNS public-IP check, no redirects, timeouts | Unit tests with private IPs |
| T11 | Stored XSS via page builder / announcements | Accounts | Blocks store data only, DOMPurify server-side, CSP with nonces | Semgrep + E2E payloads |
| T12 | Malicious uploads (slips, PDFs) | Infra/users | Magic bytes, size limits, re-encode images, strip EXIF, reject SVG/HTML, ClamAV, private buckets, signed URLs | Upload tests |
| T13 | Secret leakage (PayHere, Zoom tokens) | Money/accounts | AES-256-GCM at rest with key rotation, masked in UI, never logged, gitleaks | Unit + gitleaks |
| T14 | Minors' data exposure | Legal | Data minimisation (no NIC), guardian consent, retention policy, DSR workflow | Legal review |
| T15 | Availability attack at Saturday peak | Revenue/trust | Cloudflare WAF/DDoS, rate limits, autoscale app nodes for peaks, static public sites cached | k6 + chaos drill |

Security reviews: every PR touching auth, payments, RLS, crypto, uploads or webhooks needs **two reviewers** and the security checklist comment. External pen test before R1 if budget allows; otherwise ZAP + structured manual review, then a pen test before R2.

---

## 6. Release process

1. Trunk-based: short-lived `feat/*` / `fix/*` branches → PR → squash merge to `main` (always deployable).
2. `main` deploys automatically to **staging**; production deploys are manual (`kamal deploy`) from a tagged commit, outside freeze windows.
3. Feature flags (`tenant_features` + internal flags) to ship dark and enable per pilot institute.
4. Every release: changelog (Conventional Commits), migration notes, rollback plan (`kamal rollback` + backward-compatible migrations).
5. Post-deploy: smoke E2E (J-01, J-02, J-05) on production with a test tenant; watch dashboards 30 min.

---

## 7. Production readiness review (before R1 and R2)

| Area | Check |
| --- | --- |
| Reliability | HA DB failover tested; backups + PITR restore drill within RTO; health checks; graceful shutdown; queue retries + dead-letter |
| Capacity | k6 Saturday scenario passed; DB connection pooling sized; Bunny/Text.lk quotas confirmed |
| Security | DEVELOPMENT.md §5 "Must" = 100%; pen test/ZAP Highs fixed; secrets rotated; staff 2FA verified |
| Observability | Dashboards for SLOs; alerts route to on-call; runbooks linked from alerts |
| Support | Impersonation flow tested; support runbooks (payment disputes, device lockouts, Zoom issues, slip errors); escalation path |
| Legal | Privacy policy, terms, DPA signed by pilots; consent capture live |
| Data | Migration of pilot data verified by owners; export works |
| Comms | Status page; incident template; institute notification channel (email + WhatsApp) |
