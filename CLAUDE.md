# CLAUDE.md — rules for AI assistants working on ReMix

**Project:** ReMix by Recca Labs — multi-tenant LMS SaaS for Sri Lankan tuition teachers and institutes.
**Now building:** the LMS platform (`apps/web` + `apps/api` + `packages/db`) phase by phase — Phases 1–2 are done; Phase 3 (money) is in progress, see [`docs/plan/phase-3.md`](docs/plan/phase-3.md). `remix.lk` (`apps/site`) is built.

**How features are built:** Codex writes each track as a subagent and Claude leads (plans, writes contracts/ADRs and prompts, reviews, merges). Before planning or running any feature track, read [`docs/agents/codex-subagent.md`](docs/agents/codex-subagent.md) and follow it.

Read before non-trivial work:
- [`docs/plan/`](docs/plan/README.md) — **the development plan**: needs, feature IDs (`FEE-06`…), architecture, Definition of Done, phases. Every task maps to a feature ID; follow its acceptance criteria and the DoD in `docs/plan/04-quality.md`.
- [`DEVELOPMENT.md`](DEVELOPMENT.md) — stack, setup, full security checklist (§5), CI/quality (§7).
- [`DESIGN.md`](DESIGN.md) — tokens, components, screen → route map, UI rules.
- Visual source of truth: [`design/claude-design/*.dc.html`](design/claude-design/). Never import these; re-implement them.

## Repo map

```
apps/site/            remix.lk — Next.js 16 static export → Cloudflare Pages
  src/app/[locale]/   pages (en live; si/ta after native review)
  src/components/     layout/ (header, footer), home/, mockups/, <page>/ per page
  src/i18n/           routing.ts (locales), request.ts (loads messages), messages.ts (namespaces + types)
  src/lib/            site.ts (ROUTES, SITE, whatsappUrl), seo.ts (pageMetadata, jsonLd), fonts.ts
  messages/<locale>/  one JSON per namespace: common, home, pricing, institutes, teachers, guides, about, demo, legal
  functions/          Cloudflare Pages Functions (server code for the site, e.g. /api/lead)
  public/             _headers (security headers/CSP), _redirects, .well-known/security.txt
apps/web/             tenant sites, student portal, institute admin, platform admin (proxy.ts = host routing + CSP)
apps/api/             NestJS API (modules/, common/ guards·CSRF·rate-limit, integrations/ provider mocks)
packages/db/          Drizzle schema, RLS migrations, withTenant(), seed, tenant CLIs, isolation suite
e2e/                  Playwright journeys against the real stack
packages/ui/          theme.css (ALL design tokens) + shared React primitives (Logo, buttonClass, Container…)
packages/types/       Zod schemas + domain logic shared by all apps (pricing.ts, money.ts, lead.ts)
packages/config/      tsconfig presets
design/claude-design/ exported Claude Design files + the design brief (uploads/)
docs/decisions/       ADRs
```

## Commands (run from repo root)

```bash
pnpm install              # Node 24, pnpm via corepack
pnpm dev                  # Docker stack + migrate + seed + site/web/api dev servers
pnpm dev:site             # http://localhost:3000 → /en/
pnpm lint                 # eslint (all packages)
pnpm typecheck            # tsc --noEmit (all packages)
pnpm test                 # vitest
pnpm build                # next build → apps/site/out (static)
```

Before finishing any task: `pnpm lint && pnpm typecheck && pnpm test` must pass, and `pnpm build` for site changes.

## Rules

### Code
- TypeScript strict (`noUncheckedIndexedAccess` on). No `any`, no `@ts-ignore` without a reason comment.
- React Server Components by default. `'use client'` only for state/events (menu, calculator, tabs, forms); pass server-rendered content into client islands as props/children.
- In `apps/site` use `Link`/`usePathname` from `@/i18n/navigation`, never `next/link`. Paths come from `ROUTES` in `src/lib/site.ts`.
- Match the surrounding code: naming, comment density, file layout. One component per concern; page-specific components in `components/<page>/`.
- Don't add dependencies or services without saying why in the PR/summary. Prefer what's already installed.

### Design (see DESIGN.md)
- **No hex colours or ad-hoc colours in components** — use tokens from `packages/ui/src/theme.css` (ESLint enforces). Missing token → add it to `theme.css`.
- Inline `style` only for geometry that can't be a class (e.g. logo em-maths, `Scaled`).
- Fonts via `next/font` only. Icons via `lucide-react` only (never CDN masks). No emoji.
- Responsive at 390 / 768 / 1024 / 1440. Touch targets ≥ 44 px. Visible focus. Status = word + colour, never colour alone.
- No fake testimonials, customer logos or stats. Mockups use obvious sample data. Don't name competitors.

### i18n
- **All user-visible text lives in `messages/<locale>/<namespace>.json`** — never hard-coded in JSX. Use `t.rich()` for inline markup. Only decorative, `aria-hidden` mockup sample data is exempt.
- English is the reference; key types are generated from `messages/en/*.json` (typos fail typecheck).
- Never machine-translate Sinhala/Tamil. A locale goes live only by adding it to `routing.locales` after native review.

### Money, time, data
- Money = integer cents (`Cents`). Format with `formatLKR`. Plan prices exist **only** in `packages/types/src/pricing.ts` — never copy the numbers.
- Times stored UTC, shown in Asia/Colombo.
- All external input validated with Zod schemas from `packages/types` (`z.strictObject` — reject unknown fields).

### Security (full list: DEVELOPMENT.md §5)
- Never commit secrets. `.env*` is git-ignored; only `NEXT_PUBLIC_*` values may reach the browser and they must be non-secret.
- Site: keep `public/_headers` CSP tight — adding a third-party script/iframe/font means updating CSP deliberately. External links opened in new tabs use `rel="noopener noreferrer"`.
- JSON-LD via `jsonLd()` (escapes `<`). No `dangerouslySetInnerHTML` with user or CMS content.
- Forms: Cloudflare Turnstile verified **server-side**, Zod validation, IP rate limit, generic error messages (no stack traces).
- Platform (Phase 1+): every tenant table has `tenant_id` + RLS; tenant queries only via `withTenant()`; never bypass RLS. Roles checked in API guards **and** RLS; deny by default. Signed URLs (≤ 10 min) for files. Audit money/role/settings changes. Slow work → BullMQ. Integrations only behind provider interfaces. Encrypt integration secrets at rest.

### Tests
- Unit tests (Vitest) with every piece of logic (`*.test.ts` next to the file). Pricing/money changes must update `pricing.test.ts`.
- Phase 1+: tenant-isolation tests for every new table and endpoint.

### Agents (Codex + Claude)
- Feature tracks are written by Codex (`gpt-6.1-sol`) via `scripts/codex-track.sh`, one track per worktree; Claude Sonnet is the fallback when Codex is out of quota. Full procedure, pitfalls, prompt and report templates: [`docs/agents/codex-subagent.md`](docs/agents/codex-subagent.md).
- The lead reviews every PR before merging; money/auth/RLS/secrets code is reviewed line by line.

### Knowledge graph
- `graphify-out/` holds a graphify knowledge graph of the repo (code, docs, plan, designs). For questions about architecture or "where/how does X work", query it first (`/graphify query "…"`), then read the files it points to.
- Refresh it only at the end of a phase, by the lead (`/graphify . --update`). Feature tracks and coding agents (Claude subagents, Codex) never run graphify and never commit `graphify-out/` changes.

### Git
- Branches `feat/…`, `fix/…`; Conventional Commits with feature IDs (`feat(fees): FEE-06 …`); squash merge into `main` (always deployable). Only commit when asked.
- Commits are authored by the repo owner, Irusha Shaveen. Do not add AI co-author trailers to commit messages.
