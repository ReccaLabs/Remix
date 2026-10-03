# @remix/e2e — Playwright journeys for the Phase 1 walking skeleton

End-to-end smoke tests against the **real stack**: Chromium → the built web app (`next start`) →
the built API (`node apps/api/dist/main.js`) → Postgres 18 with row-level security and the dev
seed. Nothing is mocked. Plan: [docs/plan/04-quality.md §4.3](../docs/plan/04-quality.md).

## Run it

From the repo root (Node 24, Docker running):

```bash
pnpm install
pnpm --filter @remix/e2e exec playwright install chromium   # first time only (Chromium is all we use)

pnpm dev:stack                            # Postgres, Valkey, Mailpit, S3 (waits until healthy)
pnpm db:migrate
pnpm db:seed                              # kamalphysics, royalscience, closedacademy
WEB_API_REWRITE=true pnpm --filter @remix/api --filter @remix/web build
pnpm e2e                                  # = playwright test in this package
```

`WEB_API_REWRITE=true` matters: a production build of `apps/web` only proxies `/api/v1/*` to the
API when it was built with it (rewrites are fixed at build time). Without it the browser has no
API; `global-setup.ts` detects that and says so.

`playwright test` starts the API (`:4000`) and the web app (`:3001`) itself from those builds, so
**nothing else may be listening on those ports** (it fails rather than reuse a dev server, whose CSP
and bundles differ). The stack, migration and seed are *not* started by the tests; `global-setup.ts`
checks the three seeded tenants through the API and fails with the fix if they are missing.

- Report: `pnpm --filter @remix/e2e exec playwright show-report`. Failures keep a trace and a
  screenshot in `e2e/test-results/`.
- One journey: `pnpm e2e tests/staff.spec.ts`, one project: `pnpm e2e --project=chromium`.
- Typecheck: `pnpm --filter @remix/e2e typecheck` (also part of `pnpm typecheck`).

### Different ports or database

| Variable | Default | Notes |
| --- | --- | --- |
| `DATABASE_URL` | `remix_app` on `POSTGRES_PORT` (environment, else `infra/docker/.env`, else 5432) | the API connects as `remix_app`, never the owner |
| `E2E_WEB_PORT` | `3001` | the hosts become `<slug>.localhost:<port>` |
| `E2E_API_PORT` | `4000` | the web build must use the same `API_INTERNAL_URL` (build-time rewrite) |

A second stack beside your dev one: `COMPOSE_PROJECT_NAME=remix-e2e` plus other host ports in
`infra/docker/.env` (git-ignored), then run the same commands.

## What is covered

Hosts: `kamalphysics.localhost:3001`, `royalscience.localhost:3001`,
`closedacademy.localhost:3001` (Chromium resolves `*.localhost` to loopback itself, no hosts file).
Every journey runs in two projects: desktop Chrome and a 390 px wide Pixel-class phone.

| Spec | Journey |
| --- | --- |
| `m1-walking-skeleton` | Nimali Perera logs in on kamalphysics, sees real seeded classes of her institute only, goes Home → Classes → Me, logs out; `/app` redirects to `/login`. No console errors, page errors or `securitypolicyviolation` events |
| `login-errors` | wrong password and unknown phone show the identical generic message |
| `cross-tenant` (J-12, part) | a kamalphysics session cookie replayed on royalscience: `/app` redirects to login and `GET /api/v1/auth/session` is 401; a royalscience student cannot log in on kamalphysics |
| `tenant-status` (TEN-06) | closedacademy student sees "temporarily unavailable" (and the API answers 403); its owner logs in at `/admin/login` and gets only the billing notice |
| `staff` | Kamal logs in by email, sees the admin home with his name and role, logs out |
| `routing` | unknown host is 404; direct `/tenant/...` and `/platform/...` are 404; `?next=//evil.example` ends on `/app` |
| `security-headers` | CSP with a fresh nonce on HTML responses and on the 404 page |
| `accessibility` | axe (WCAG 2.x A/AA): no serious or critical violations on login, classes, home and admin home, colour contrast included |

## Rules for new journeys

- Real API and seeded DB only. Independent of each other and of run order.
- **Login limits.** The API's login limiter is 5 attempts per minute per phone and 20 per minute
  per client IP. The config gives each project its own client IP (`X-Forwarded-For`, trusted from
  loopback) and `support/accounts.ts` hands each journey its own seeded student. A journey that
  logs in picks a student nobody else uses; do not put a new login on an existing student.
- Use roles and visible text (`getByRole`, `getByLabel`), and `support/accounts.ts` for the seed data.
- Seed data is dev-only (password `remix-dev-password`, `packages/db/README.md`). Never real credentials.
