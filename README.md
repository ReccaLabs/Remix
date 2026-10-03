# ReMix

Multi-tenant LMS for Sri Lankan tuition teachers and institutes — by **Recca Labs**, Colombo.
Own website, fees and bank slips, protected video, Zoom with name lock, and attendance.

| Doc | What's in it |
| --- | --- |
| [docs/plan/](docs/plan/README.md) | **Development plan**: product needs, features, architecture, Definition of Done, phased roadmap |
| [DEVELOPMENT.md](DEVELOPMENT.md) | Stack, setup, full security checklist, CI/CD |
| [DESIGN.md](DESIGN.md) | Design tokens, components, screen → route map, UI rules |
| [CLAUDE.md](CLAUDE.md) | Rules for AI coding assistants (and a good summary for humans) |
| [SECURITY.md](SECURITY.md) | Vulnerability reporting and security baseline |
| [docs/decisions/](docs/decisions/) | Architecture decision records |

## Quick start

Requires Node 24 and pnpm (`corepack enable`). The platform stack also needs Docker.

```bash
pnpm install
pnpm dev:site        # remix.lk at http://localhost:3000/en/
pnpm dev             # everything: Docker stack, migrate, seed, then site + web + API
```

`pnpm dev` starts [`infra/docker/compose.yaml`](infra/docker/compose.yaml) and waits until it is healthy, applies migrations, seeds the dev tenants if the database is empty (`pnpm dev --reseed` resets them), then runs site (`:3000`), web (`http://kamalphysics.localhost:3001`) and API (`:4000`). It is safe to re-run. The pieces are also available alone: `pnpm dev:stack` (`pnpm dev:stack down` stops it), `pnpm db:migrate`, `pnpm db:seed`, `pnpm dev:web`, `pnpm dev:api`. If a host port is taken (on Windows often 1025 or 6379), `pnpm dev` names the port and how to override it in `infra/docker/.env` (see `.env.example`). **Local staging:** `pnpm stack:prod` builds the production Docker images of web and API and runs them on the same stack and hosts (`http://kamalphysics.localhost:3001`); `pnpm stack:prod:down` stops them (`--all` also stops the infra). Database tests share the dev stack's Postgres (a fresh `remix_test_*` database per run, dropped afterwards) and fall back to a Testcontainers Postgres when it is not running. Seed logins: [packages/db/README.md](packages/db/README.md#seed-logins-dev-only--never-real-credentials).

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm build
```

## Deploying remix.lk (Cloudflare Pages)

- **Root directory:** `apps/site` (Cloudflare only picks up `functions/` and `wrangler.toml` from the root directory). **Build command:** `cd ../.. && pnpm install --frozen-lockfile && pnpm --filter @remix/site build`. **Output:** `out`.
- Public env: `NEXT_PUBLIC_TURNSTILE_SITE_KEY`, `NEXT_PUBLIC_WHATSAPP_NUMBER`, `NEXT_PUBLIC_CF_ANALYTICS_TOKEN`.
- Secrets: `TURNSTILE_SECRET_KEY` (required, lead form fails closed without it), `RESEND_API_KEY` (optional).
- D1 database for leads, migration and the WAF rate-limit rule: see [apps/site/functions/README.md](apps/site/functions/README.md).

## Layout

```
apps/
  site/       remix.lk — Next.js static export on Cloudflare Pages   ← Phase 0 (now)
  web/        tenant sites, student portal, institute + platform admin (Phase 1)
  api/        NestJS API, workers, realtime (Phase 1)
packages/
  ui/         design tokens (theme.css) + shared React components
  types/      Zod schemas + shared domain logic (pricing, money, lead)
  config/     tsconfig presets
design/
  claude-design/   Claude Design exports (.dc.html) — the visual source of truth
docs/decisions/    ADRs
```
