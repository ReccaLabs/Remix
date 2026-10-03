# Status report (3 Oct 2026) and Phase 2 plan — People & classes

> Part of the [ReMix development plan](README.md). Part A reports where the project stands after Phase 1. Part B is the execution plan for Phase 2 ([05-roadmap.md → Phase 2](05-roadmap.md#phase-2--people--classes-weeks-57)). Phase 1 details: [phase-1.md](phase-1.md) · Sinhala summary: [phase-1-report-si.md](phase-1-report-si.md).

---

# Part A — Where we are

## A1. Delivered in Phase 1 (on `main`, CI green)

| Area | What exists | Proof |
| --- | --- | --- |
| Plan + decisions | Development plan, ADRs 0003–0007 (same-origin API, own auth, RLS tenancy, web→API only, IDs/money/time) | `docs/plan`, `docs/decisions` |
| Database (`packages/db`) | 12 tables with row-level security, 4 DB roles, `withTenant()`, composite tenant FKs, tenant resolver, per-tenant counters, seed (Kamal Physics × 2,000 students), `tenant:create` and `tenant:reset-owner-password` CLIs | 205 tests incl. the isolation suite; a broken policy fails 11 |
| API (`apps/api`) | NestJS core: problem+json errors, CSRF guard, deny-by-default auth, rate limiter, health checks, provider mocks, Docker image. Tenancy (TEN-01/02/06), student + staff login (AUTH-01, AUTH-05 basic), opaque rotating sessions, `/me/classes`, audit logs | 471 tests incl. integration tests against Postgres |
| Web (`apps/web`) | Host-based routing (institute vs platform), CSP with nonces, student login, portal home + classes, staff login, admin home skeleton, logout, session refresh | 187 tests |
| UI kit (`packages/ui`) | Form, feedback and data primitives; Portal / Admin / Platform shells | 57 tests incl. axe |
| Contracts (`packages/types`) | API schemas, endpoint registry, typed client | 95 tests |
| E2E (`e2e/`) | 17 Playwright journeys × desktop + phone (login → classes, cross-tenant, suspended institute, staff, routing, CSP, accessibility) | 34 runs green |
| CI | Lint · typecheck · test · build · audit, tenant-isolation job, API image + Trivy, E2E, gitleaks, Semgrep; actions pinned to SHAs; grouped Dependabot | All 6 jobs green on `main` |
| Security | Independent review: S-01 (High) … S-07 and N-1 … N-3 fixed with tests | [phase-1.md](phase-1.md) |
| Local dev | `pnpm dev` = Docker stack + migrate + seed + site/web/api | README |

**Phase 1 exit criteria:** isolation suite ✅ · login → classes end to end ✅ (locally) · ADRs 0003–0007 ✅ · one-command setup ✅. **Phase 1 is closed.** ADRs 0012/0013 move to Phase 2 wave 0; the Hetzner staging server moves to Phase 8 (A4).

## A2. Repository housekeeping (done 3 Oct)

- PR #26 fixed the two CI failures on `main` (dependency audit, Semgrep); PR #27 grouped Dependabot.
- Dependabot PRs went from **18 → 6**. Closed with reasons: `@types/node` 26 (we run Node 24), NestJS 12 and ESLint 10 (major upgrades, planned separately).
- Local work branches deleted after squash merge; `main` is the only long-lived branch.

### Open Dependabot PRs (merge only when all 6 checks are green)

| PR | Status | Action |
| --- | --- | --- |
| #32 minor-and-patch group | ✅ green | Squash and merge |
| #31 nestjs group (11.x) | ✅ green | Squash and merge |
| #29 GitHub Actions group | ✅ green | Squash and merge |
| #18 next-react group | ✅ green | Squash and merge |
| #30 tooling group | ❌ 2 checks fail | Investigate in track P2-0 (likely a lint-rule or type change) |
| #28 dev-stack images | ❌ 1 check fails | Investigate in track P2-0 |

## A3. Carry-over from Phase 1 (must close before or during Phase 2)

| # | Item | Owner | Why it matters |
| --- | --- | --- | --- |
| C1 | **Local staging** (`pnpm stack:prod`): production Docker images of web + API with the full stack on the dev machine | Claude (P2-0) | Phase demos run on it until Hetzner (A4) |
| C2 | **Protect `main`** — require PR + all CI checks; allow only "Squash and merge" | Irusha (GitHub settings) | DEVELOPMENT.md §5.7 "Must"; keeps history one commit per PR |
| C3 | ADR 0012 (jobs: BullMQ, Valkey, cron locks) and ADR 0013 (observability) | Claude | Phase 2 needs a queue for SMS codes and CSV import |
| C4 | Shared local test database (one Postgres, fresh DB per test run) instead of a container per run | Claude | Faster tests, no more Docker overload on the dev laptop |
| C5 | `pnpm dev` explains blocked Windows ports (6379 / 1025) instead of "not healthy" | Claude | Every Windows developer hits it |
| C6 | Valkey-backed rate limiter (replaces in-memory) | Claude | Limits must hold across API nodes before pilots |
| C7 | NestJS 12 and ESLint 10 upgrades | Claude | Planned majors closed from Dependabot |

## A4. Environments until the pilot (decision, 3 Oct 2026)

| Environment | Where | Used for | When |
| --- | --- | --- | --- |
| **Development** | Laptop: Docker (Postgres, Valkey, Mailpit, S3) + `pnpm dev` | Building features, hot reload | Now |
| **Local staging** | Laptop: the **production Docker images** of web + API + the same stack (`pnpm stack:prod`) | Phase demos, E2E, "will it work on a server?" | From Phase 2 wave 0 |
| Local staging + **Cloudflare Tunnel** | Temporary public HTTPS address to the laptop | PayHere sandbox notify, Zoom and Bunny webhooks | Phases 3–5 |
| **Hetzner staging + production** | Cloud servers, Kamal deploy, Cloudflare, Sentry | Pilot institutes (24/7) | **Phase 8** |

Nothing needs to be public before pilots, the hosting cost is saved meanwhile, and the images verified locally are deployed to Hetzner unchanged. Recorded in [05-roadmap.md](05-roadmap.md).

---

# Part B — Phase 2 plan: People & classes

## B1. Goal

**Institutes can load their students and classes, staff can work with them, and students can manage their own account** — the first phase an owner could actually start using.

## B2. Scope (feature IDs → [02-features.md](02-features.md))

| Module | Features | In one line |
| --- | --- | --- |
| Auth completion | AUTH-02, 03, 04, 07, 08, 09 | Forgot password by SMS code, **2-device limit**, student "Me" (devices, password, language), staff invite + first login, admin signs out devices / resets password, lockout |
| Staff | STF-01, 02, 03 | Invite staff with a role, teachers limited to their classes, plan limits (Tutor: 1 teacher, 0 cashiers) |
| Students | STU-01, 02, 03, 05, 07 | Students table with search/filters/bulk actions, add student (auto number), profile tabs, archive |
| Import | STU-04, DAT-01 | CSV/Excel import: column mapping, validation preview, duplicates, dry run, error file |
| Classes | CLS-01 … 06 | Classes list, create/edit, detail tabs, enrol/move/remove with fee overrides, halls, weekly timetable |
| Parents | PAR-01, PAR-03 | Guardian records with SMS preferences; parental consent for under-18s (PDPA) |
| Theme | TEN-03 | Institute logo + brand colour (contrast-checked) on portal and admin |
| Shells | — | Admin dashboard with real counts; portal Home / Classes / Me |

Out of scope (later phases): fees and payments (Phase 3), lessons (4), Zoom and attendance (5), SMS compose (6), platform admin (7 — see B9).

## B3. Exit criteria (from the roadmap)

- [ ] Owner imports **500 students from CSV** with validation preview (J-08)
- [ ] **2-device limit** works end to end (J-01); admin can sign out devices
- [ ] Staff invite + 2-step login for owner/cashier; teacher sees only own classes (permission tests)
- [ ] Classes CRUD with schedules; timetable feeds the dashboard "Today's classes"
- [ ] Institute theme colour/logo applied to portal and admin
- [ ] Every new table has RLS + isolation tests; every new endpoint has a cross-tenant test
- [ ] Demo on **local staging** (`pnpm stack:prod`) with the journeys above green

## B4. New data (each with `tenant_id`, RLS, factory, isolation test)

`guardians`, `student_guardians`, `consents` (PAR-01/03) · `halls` (CLS-05) · `staff_invites` (AUTH-07, hashed token, 72 h) · `otp_challenges` (AUTH-02/05/07, hashed code, attempts, expiry) · `import_jobs` + `import_rows` (STU-04) · `tenant_settings` (TEN-03 theme). Existing tables gain what the screens need (e.g. `students` filters, `enrollments` reasons).

## B5. Decisions needed before building

| ADR / decision | Question | Proposed |
| --- | --- | --- |
| **0012 Jobs** | How do SMS codes and imports run without blocking requests? | BullMQ on Valkey, worker entry already exists, idempotent jobs, cron lock |
| OTP design (ADR 0004 addendum) | Code length, expiry, attempts, resend timer | 6 digits, 10 min, 5 attempts, 45 s resend, 3 per 15 min per phone; codes stored hashed; `+947…` numbers only (T7) |
| SMS in Phase 2 | Real Text.lk or mock? | **Mock provider** (codes visible in the dev log / Mailpit-style viewer); real Text.lk wiring in Phase 3 |
| Import format | CSV only or Excel too? | CSV + `.xlsx` (SheetJS-free parser to avoid supply-chain risk — decide in the track) |

## B6. Designs needed (gaps from [05-roadmap.md §4](05-roadmap.md#4-design-gaps-screens-not-yet-designed))

Settings → Staff and roles (invite, roles, 2FA status) · **Import wizard** (mapping, preview, errors) · Student first-login / set password · Staff invite acceptance · Global empty / loading / error / permission-denied states. Without designs, the tracks build from the existing Admin Students / Admin Classes / Student Me screens and DESIGN.md patterns; you review screenshots before merge.

## B7. Tracks and order

Lessons from Phase 1 applied: **at most 2 agents at once**, one shared test database, Sonnet by default, Opus only for security-critical work and reviews, every agent cleans up its processes and ports.

| Wave | Track | Model | Delivers |
| --- | --- | --- | --- |
| 0 | **P2-0 Foundations** (lead) | — / Sonnet | **C1 local staging (`pnpm stack:prod`)**, C3 ADR 0012 + OTP addendum, C4 shared test DB, C5 port message, C6 Valkey limiter, fix Dependabot #28/#30, contracts for all Phase 2 endpoints in `packages/types/src/api` |
| 1 | **P2-A Auth completion** | **Opus** (security) | AUTH-02/03/04/07/08/09: OTP challenges, 2-device limit + device list, staff invite + first login, admin device sign-out, lockout; API + web screens |
| 1 | **P2-B People** | Sonnet | STU-01/02/03/05/07, PAR-01/03, STF-01/02/03: students + guardians + staff APIs and admin screens, permission tests |
| 2 | **P2-C Classes & timetable** | Sonnet | CLS-01…06, halls, enrolments with fee overrides, timetable → dashboard "Today's classes", TEN-03 theme |
| 2 | **P2-D Import** | Sonnet | STU-04 / DAT-01 import wizard on the `imports` queue: mapping, preview, dry run, error file, 500-row test |
| 3 | **P2-E Verify** | Sonnet (E2E) + **Opus** (review) | Playwright J-01 (device limit) and J-08 (import), permission journeys; independent security review of OTP, invites, device limit, import uploads |

Each track: branch → PR → all CI green → squash merge. Lead reviews every PR; auth/RLS PRs get the Opus review before merge.

## B8. Estimate

Roadmap budget: **weeks 5–7** for 2–3 developers. With the Phase 1 foundation in place and the leaner way of working, expect about **3–4 working sessions** of agent time, plus your review of screens. Usage limits are the main pacing factor, so tracks are sized to finish within one session each.

## B9. Optional: minimal platform admin early

The full Recca Labs admin (`admin.remix.lk`: AUTH-06, PLT-01…07, BIL-*) is Phase 7. If you want to onboard pilot institutes without the command line sooner, a **small slice** can join Phase 2 as track P2-F (Sonnet + Opus review):
platform staff login with TOTP · institutes list · create institute (replaces `tenant:create`) · suspend / reactivate. **Decision for Irusha:** include P2-F in Phase 2, or keep it in Phase 7.

## B10. Risks

| Risk | Mitigation |
| --- | --- |
| No designs for import wizard / staff settings | Build from existing patterns; screenshot review before merge |
| SMS fraud on OTP endpoints (T7) | `+947` only, per-phone/IP/tenant quotas, Turnstile after failures, Valkey limiter (C6) |
| CSV import with bad or malicious data (T12) | Size/row limits, strict Zod per row, no formulas executed, dry run before commit |
| Laptop is the only environment | Local staging runs the real production images; E2E runs on it; CI runs everything again on GitHub for every PR |
| Usage limits / laptop load | ≤ 2 agents, shared test DB, tracks sized to one session |

## B11. Next actions

1. **Irusha:** merge the green Dependabot PRs (#32, #31, #29, #18); turn on branch protection + squash-only (C2); decide on B9 (early platform admin). No server needed until Phase 8.
2. **Claude:** start wave 0 (P2-0) on your go-ahead.
