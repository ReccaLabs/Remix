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

Requires Node 24 and pnpm (`corepack enable`).

```bash
pnpm install
pnpm dev:site        # remix.lk at http://localhost:3000/en/
```

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
