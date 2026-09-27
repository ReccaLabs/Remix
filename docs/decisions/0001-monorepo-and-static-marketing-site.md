# 0001 — Monorepo, with remix.lk as a separate static app

- **Status:** Accepted · 2026-09-25

## Context

We need a marketing site now and a multi-tenant LMS (web + API) next. Sales must not stop if the LMS servers have an incident. The team is small and cost-sensitive.

## Decision

- One **pnpm + Turborepo monorepo**: `apps/site`, `apps/web`, `apps/api`, shared `packages/ui`, `packages/types`, `packages/config`.
- `apps/site` is **Next.js 16 with `output: 'export'`**, deployed to **Cloudflare Pages**. Server-side needs (the demo form) run as **Pages Functions** with D1.
- Design tokens live once in `packages/ui/src/theme.css` (Tailwind v4 `@theme`) and are shared by every app.
- Domain data that must match between marketing and billing (plan prices) lives in `packages/types` as integer cents, with tests.
- Workspace packages ship TypeScript source (`transpilePackages`), no separate build step.

## Consequences

- remix.lk is free to host, globally cached, and independent of Hetzner.
- No Next.js middleware on the site (static export): locale redirect via `public/_redirects`, security headers via `public/_headers`.
- The site can't use ISR/SSR; content changes need a rebuild (fine for a marketing site; Pages builds on every push).
