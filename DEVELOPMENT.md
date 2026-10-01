# ReMix — Development Guide

> The single guide for building ReMix, by Recca Labs.
> **First target: the ReMix company website `remix.lk`** (from the Claude Design files). Then the LMS platform.
> Keep this file in the repo root as `DEVELOPMENT.md`. If you use Claude Code, also copy the "Rules for AI assistants" section into `CLAUDE.md`.

---

## 0. Changes I recommend to the earlier plan

These keep the architecture reliable and cheap. Everything else from earlier docs stays.

| # | Change | Why |
| --- | --- | --- |
| 1 | **Build remix.lk as its own static app (`apps/site`) hosted on Cloudflare Pages**, not on our Hetzner servers | Free, served from Cloudflare's global network, and stays online even if our LMS servers are down. Sales never stop. |
| 2 | **Use a vetted auth library (Better Auth) instead of writing login/sessions ourselves**; evaluate in sprint 1 | Hand-written auth is where most security bugs live. It has phone-number/OTP, session listing/revocation (needed for the 2-device rule) and organisation support. Fall back to our own JWT design only if it doesn't fit. **Superseded:** we build our own auth with opaque, DB-backed sessions — see [ADR 0004](docs/decisions/0004-own-authentication.md). |
| 3 | **Hash passwords with Argon2id** (not bcrypt) | Current OWASP recommendation. |
| 4 | **Database high availability before the first paying institute**: primary + standby with automatic failover | The DB is the one part that takes every institute down. |
| 5 | **Servers on a Hetzner private network; only Cloudflare can reach the app; the DB has no public IP** | Removes most direct attack paths for free. |
| 6 | **Bank slips and tutes in a private R2 bucket, served only through short-lived signed URLs** | Bank slips contain personal and financial data. |
| 7 | **SSRF protection on "bring your own SMS gateway"** | An institute-entered URL could otherwise make our server call internal addresses. |
| 8 | Keep the **modular monolith** (Next.js + NestJS in one monorepo). No microservices, no Kubernetes | Cheapest, simplest, reliable enough until 100+ institutes; "cells" come later. |

---

## 1. Architecture at a glance

```
                        Cloudflare (DNS, SSL, WAF, DDoS, cache)
            ┌──────────────────────┴──────────┐
            ▼                                 ▼
   remix.lk (apps/site)     *.remix.lk + custom domains + admin.remix.lk
   Cloudflare Pages         edge proxy, same origin on every host (ADR 0003):
   static, free               /api/v1/*  → apps/api (NestJS): REST API, auth,
   + Pages Functions                       workers, realtime
   (demo form)                everything else → apps/web (Next.js): portal,
                                           institute admin, platform admin
                                              │
                                              ▼
                              Hetzner private network
                    ┌──────────────┬──────────────┬──────────────┐
                    ▼              ▼              ▼              ▼
               app nodes (2+)   worker       Valkey/Redis    PostgreSQL 18
               web + api        (BullMQ)                     primary + standby
                                                            (+ continuous backups
                                                               to other provider)
   External: Bunny Stream (video) · Cloudflare R2 (files) · PayHere · Text.lk · Zoom · email provider
```

### Repository layout

```
remix/
├── apps/
│   ├── site/        Next.js (static export) → remix.lk marketing site      ← FIRST
│   ├── web/         Next.js → institute sites, student portal, admin areas
│   ├── api/         NestJS → API, workers, realtime
│   ├── mobile/      Expo (later)
│   └── gate/        Expo (later, ReMix+)
├── packages/
│   ├── ui/          shared React components + Tailwind theme (from ReMix Brand)
│   ├── db/          Drizzle schema, migrations, tenant helper
│   ├── types/       Zod schemas shared by all apps
│   └── config/      eslint, tsconfig, prettier presets
├── design/
│   └── claude-design/   exported Claude Design files (.dc.html) — the visual source of truth
├── infra/
│   ├── docker/          compose files, postgres init
│   └── deploy/          Kamal config, server setup scripts
├── docs/decisions/      ADRs
├── DEVELOPMENT.md       this file
└── CLAUDE.md            rules for AI assistants
```

### Tech stack (final)

| Layer | Choice |
| --- | --- |
| Language | TypeScript everywhere |
| Monorepo | pnpm workspaces + Turborepo |
| Marketing site | Next.js 16 (App Router) with `output: 'export'`, Tailwind CSS v4, next-intl (en / si / ta), MDX for Guides |
| App front end | Next.js 16, Tailwind v4, shadcn/ui, TanStack Query, react-hook-form + Zod |
| Backend | NestJS, Drizzle ORM, PostgreSQL 18, Valkey (Redis-compatible), BullMQ, Socket.io |
| Auth | Own implementation ([ADR 0004](docs/decisions/0004-own-authentication.md)): Argon2id, opaque DB-backed sessions, SMS OTP later |
| Files / video | Cloudflare R2 (private buckets), Bunny Stream (Volume tier) |
| Integrations | PayHere (institute's own merchant), Text.lk + BYO gateway adapters, Zoom OAuth app |
| Hosting | Cloudflare Pages (site), Hetzner Cloud Germany/Finland (app), Docker + Kamal |
| Observability | Sentry, Grafana/Prometheus/Loki (or Better Stack free tier), Uptime Kuma, Cloudflare Web Analytics |
| CI/CD | GitHub Actions |

---

## 2. Tools and accounts

**Install:** Node 24 LTS, pnpm (`corepack enable`), Docker Desktop, Git, VS Code (ESLint, Prettier, Tailwind CSS IntelliSense, Docker), a Postgres client (DBeaver/TablePlus).

**Accounts (free tiers first):**

| Service | Needed for | When |
| --- | --- | --- |
| GitHub (private repo, 2FA on) | Code, CI | Day 1 |
| Cloudflare | DNS for remix.lk, Pages, Turnstile, R2, Web Analytics | Day 1 |
| Domain `remix.lk` | Registered through the LK Domain Registry or an accredited reseller; point nameservers to Cloudflare | Day 1 |
| Email provider (Resend, Amazon SES or similar) | Demo-form notifications, later receipts | Phase 0 |
| Google Workspace or Zoho Mail | `hello@remix.lk`, `security@remix.lk` | Phase 0 |
| Hetzner Cloud | App servers | Phase 1 |
| Bunny.net | Video | Phase 1 |
| PayHere sandbox | Payments | Phase 1 |
| Text.lk | SMS | Phase 1 |
| Zoom Marketplace | Zoom app (submit for review early) | Phase 1 |
| Sentry | Error tracking | Phase 0 |

Turn on 2FA for **every** account above. Use a password manager (Bitwarden/1Password) shared across the team.

---

## 3. PHASE 0 — Build remix.lk (first target, ~3 weeks)

### 3.1 Pages (from the Claude Design files)

| Route | Design file | Notes |
| --- | --- | --- |
| `/` | `ReMix Home.dc.html` | Hero, problems, features, pricing calculator, FAQ, CTA |
| `/pricing` | `Pricing.dc.html` | Plans, add-ons, calculator, FAQ |
| `/for-institutes` | `For Institutes.dc.html` | |
| `/for-teachers` | `For Teachers.dc.html` | |
| `/guides` + `/guides/[slug]` | `Guides.dc.html` | Articles written in MDX |
| `/about` | `About.dc.html` | |
| `/demo` | (build from brand) | Book a demo / start trial form |
| `/find-your-class` | (build from brand) | Search institutes → redirect to their site |
| `/privacy`, `/terms`, `/data-protection` | (simple text pages) | Required before launch |
| Shared | `Site Header.dc.html`, `Site Footer.dc.html`, `ReMix Logo.dc.html`, `ReMix Brand.dc.html` | Components + theme |

The `Institute Dashboard.dc.html` file is for the product (Phase 2), used on the site only as a screenshot.

### 3.2 Put the design files in the repo

1. In Claude Design, export/download the project files.
2. Copy them into `design/claude-design/` (keep the original names).
3. Commit them. They are the visual reference; code never imports them directly.

### 3.3 Create the site app

```bash
# from repo root (monorepo created as in section 5.1 if not done yet)
pnpm create next-app@latest apps/site --ts --tailwind --eslint --app --src-dir --import-alias "@/*" --use-pnpm
cd apps/site
pnpm add next-intl @next/mdx @mdx-js/react clsx
```

`apps/site/next.config.ts`

```ts
import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin();
const config: NextConfig = {
  output: 'export',          // static HTML → Cloudflare Pages
  images: { unoptimized: true },
  trailingSlash: true,
};
export default withNextIntl(config);
```

Folder structure:

```
apps/site/src/
├── app/[locale]/
│   ├── layout.tsx          Header + Footer, fonts, metadata
│   ├── page.tsx            Home
│   ├── pricing/page.tsx
│   ├── for-institutes/page.tsx
│   ├── for-teachers/page.tsx
│   ├── guides/page.tsx  + guides/[slug]/page.tsx
│   ├── about/page.tsx
│   ├── demo/page.tsx
│   └── (legal)/privacy/page.tsx …
├── components/             Hero, FeatureGrid, PricingCalculator, FAQ, CTA …
├── content/guides/*.mdx
├── messages/en.json  si.json  ta.json
└── lib/pricing.ts          ONE source of truth for plan prices
```

URLs: `/en/…`, `/si/…`, `/ta/…`. Add `public/_redirects` with `/  /en/  302` so the root goes to English. (Static export cannot use Next.js middleware for language detection; a language switcher in the header handles it.)

### 3.4 Turn the design into code

1. **Theme first.** Read `ReMix Brand.dc.html` and put its colours, fonts, radii and spacing into `packages/ui/theme.css` as Tailwind v4 tokens:

   ```css
   @import "tailwindcss";
   @theme {
     --color-brand: #2B4BF2;      /* replace with the exact values from ReMix Brand */
     --color-accent: #F2A516;
     --color-ink: #0E1525;
     --color-muted: #5B6478;
     --color-line: #E4E7EE;
     --color-canvas: #F6F7FA;
     --font-display: "Bricolage Grotesque", sans-serif;
     --font-sans: "Geist", system-ui, sans-serif;
     --radius-card: 16px;
   }
   ```

2. **Fonts** with `next/font` (self-hosted at build, no Google request at runtime), including Noto Sans Sinhala and Noto Sans Tamil.
3. **Components:** Logo, Header (with mobile menu and language switcher), Footer, Button, Section, FeatureCard, PlanCard, PricingCalculator, FAQ (accessible accordion), CTA band.
4. **Pages:** assemble components per design file. All text goes into `messages/*.json`, never hard-coded.
5. **Compare** each page side by side with the design at 1440, 1024, 768 and 390 px.

Claude Code prompt that works well for step 3–4 (one page at a time):

```
Read design/claude-design/Pricing.dc.html and packages/ui/theme.css.
Implement apps/site/src/app/[locale]/pricing/page.tsx as React Server Components with Tailwind v4 classes using our
theme tokens (no inline styles, no hex values). Reuse components from apps/site/src/components; create new ones only
if missing. Put all visible text in messages/en.json under "pricing". Prices come from lib/pricing.ts.
Make it responsive (390, 768, 1024, 1440) and accessible (semantic headings, buttons, labels, focus states).
```

### 3.5 Pricing calculator (single source of truth)

```ts
// apps/site/src/lib/pricing.ts  (later moved to packages/types so the app bills with the same numbers)
export const PLANS = {
  lite:       { base: 1500,  perStudent: 30, maxStudents: 100 },
  tutor:      { base: 3000,  perStudent: 50, maxStudents: 150 },
  institute:  { base: 9900,  perStudent: 45, maxStudents: 1500 },
  enterprise: { base: 25000, perStudent: 35, maxStudents: Infinity },
} as const;

export function monthlyPrice(students: number, youtubeOnly = false) {
  const plan = youtubeOnly && students <= 100 ? 'lite'
    : students <= 150 ? 'tutor' : students <= 1500 ? 'institute' : 'enterprise';
  const p = PLANS[plan];
  return { plan, total: p.base + p.perStudent * students };
}

export function perCardPrice(students: number, classesPerStudent = 1.5, perCard = 150, minimum = 10000) {
  return Math.max(minimum, Math.round(students * classesPerStudent * perCard));
}
```

Write unit tests for these (Vitest). Wording on the site: "per-class-card pricing" — don't name competitors.

### 3.6 Demo / trial form (no server of ours needed)

- Form fields: name, phone (+94), WhatsApp same?, institute name, number of students, city, message.
- Protected by **Cloudflare Turnstile** (free CAPTCHA alternative).
- Submitted to a **Cloudflare Pages Function** (`apps/site/functions/api/lead.ts`) that:
  1. verifies the Turnstile token server-side,
  2. validates input with Zod (length limits, phone format),
  3. rate-limits by IP (Cloudflare rule),
  4. sends an email to `sales@remix.lk` and stores the lead in Cloudflare D1 (free SQLite) — later moved to the platform DB.
- Show a clear privacy line under the form ("We use this only to contact you about ReMix").

### 3.7 SEO, performance and analytics

- `generateMetadata` per page: title, description, canonical, `alternates.languages` (hreflang en/si/ta), Open Graph image.
- `sitemap.xml` and `robots.txt` generated at build.
- JSON-LD: `Organization` and `SoftwareApplication` (with price range) on Home/Pricing.
- Performance budget: Lighthouse ≥ 95 on mobile; LCP < 2.5 s on 4G; images AVIF/WebP with width/height; no client JS except header menu, calculator, FAQ, form.
- Analytics: **Cloudflare Web Analytics** (free, no cookies → no cookie banner needed).
- Guides: 3–5 useful Sri Lankan articles at launch (e.g. "How to start an online tuition class", "How to stop Zoom link sharing").

### 3.8 Security headers for the site (`apps/site/public/_headers`)

```
/*
  Strict-Transport-Security: max-age=31536000; includeSubDomains; preload
  X-Content-Type-Options: nosniff
  X-Frame-Options: DENY
  Referrer-Policy: strict-origin-when-cross-origin
  Permissions-Policy: camera=(), microphone=(), geolocation=()
  Content-Security-Policy: default-src 'self'; script-src 'self' 'unsafe-inline' https://challenges.cloudflare.com https://static.cloudflareinsights.com; frame-src https://challenges.cloudflare.com; img-src 'self' data:; style-src 'self' 'unsafe-inline'; connect-src 'self' https://cloudflareinsights.com; font-src 'self'
```

(Tighten `'unsafe-inline'` with nonces/hashes later; Next.js static export inlines some scripts.) Add `public/.well-known/security.txt` with `Contact: mailto:security@remix.lk`.

### 3.9 Deploy remix.lk

1. Cloudflare → Workers & Pages → Create → Pages → connect the GitHub repo.
2. Build command: `pnpm --filter @remix/site build`; output directory: `apps/site/out`.
3. Every pull request gets a preview URL; `main` deploys to production.
4. Custom domains: `remix.lk` and `www.remix.lk` (redirect www → apex).
5. Cloudflare: SSL "Full (strict)", Always Use HTTPS, HSTS, Bot Fight Mode on.

### 3.10 Phase 0 done when

- [ ] All pages built, matching the design at 4 widths
- [ ] English complete; Sinhala and Tamil text reviewed by native speakers (or hidden until ready)
- [ ] Demo form works end to end with Turnstile, email and stored lead
- [ ] Lighthouse mobile ≥ 95 (performance, accessibility, best practices, SEO)
- [ ] Privacy policy, terms, data-protection page published
- [ ] security.txt, security headers, HSTS verified (securityheaders.com grade A)
- [ ] No fake testimonials, logos or numbers on the site

---

## 4. PHASE 1–5 — The LMS platform (after the site)

> **Superseded for planning:** the detailed phases (1–10), exit criteria, feature IDs and Definition of Done now live in [docs/plan/](docs/plan/README.md). The table below is kept as the original outline; the rules in §4.1 still apply.

| Phase | Weeks | Deliver |
| --- | --- | --- |
| 1 Foundation | 4–5 | Monorepo apps `web` + `api`, Docker Compose, CI, DB schema + RLS, tenant routing (`*.localhost`), isolation tests, Better Auth evaluation |
| 2 People & money | 6–9 | Login (phone + password/OTP, 2-device limit), roles, students import, classes, enrollments, invoices, PayHere (institute's own merchant), bank-slip queue, receipts |
| 3 Learning | 10–13 | Lessons: Bunny protected video + YouTube mode, watermark, PDF watermark, month locking; Zoom OAuth connect, scheduled sessions, registrant join links |
| 4 Institute tools | 14–16 | Institute website (theme + Puck builder), QR attendance, SMS (ReMix wallet + BYO gateway), reports, platform admin (institutes, plans, suspend, log-in-as) |
| 5 Launch | 17–18 | Production HA setup, backups + restore drill, load test (4,000 logins/2 min), pen-test checklist, 3 pilot institutes live |

Detailed setup for Phase 1 (commands, Docker Compose, Drizzle schema, RLS SQL, tenant middleware) is in `REMIX_PROJECT_START.md` — keep using it, with the changes in section 0.

### 4.1 Core rules the platform code must follow

1. Every tenant table has `tenant_id` + Row Level Security; the app DB user is **not** the table owner.
2. All tenant queries go through `withTenant(tenantId, tx => …)` (sets `app.tenant_id` with `SET LOCAL`).
3. Money in integer cents; times in UTC, shown in Asia/Colombo.
4. All input validated with Zod schemas from `packages/types`.
5. Slow work (SMS, receipts, reports, webhooks) goes to BullMQ, never in the request.
6. Integrations sit behind interfaces: `SmsProvider`, `VideoProvider` (Bunny / YouTube), `PaymentProvider` (PayHere), `MeetingProvider` (Zoom).
7. Every change to money, enrollments, roles and settings is written to `audit_logs`.

---

## 5. Security — full checklist

Treat this as a release gate: nothing goes to real institutes until every "Must" item is done.

### 5.1 Identity and access

| Item | Level |
| --- | --- |
| Argon2id password hashing (OWASP parameters), minimum 8 characters, block common passwords | Must |
| Rate limits: login 5/min per phone + 20/min per IP; OTP 3 per 15 min per phone; lockout with SMS unlock | Must |
| Sessions: opaque token (SHA-256 hash stored) in a host-only `HttpOnly; Secure; SameSite=Lax` cookie, rotated every 15 min with reuse detection; revoke on password change ([ADR 0004](docs/decisions/0004-own-authentication.md)) | Must |
| 2-device limit with visible device list and "sign out other device" | Must |
| Roles checked in API guards **and** RLS; deny by default | Must |
| Platform staff: separate table, **mandatory 2FA (TOTP)**, IP allowlist optional, all actions audited | Must |
| "Log in as institute": reason required, time-limited (30 min, per [PLT-04](docs/plan/02-features.md#plt--platform-admin)), banner visible, audited | Must |
| Parents only see their linked children | Must |

### 5.2 Multi-tenant isolation

| Item | Level |
| --- | --- |
| RLS on every tenant table; `app_tenant_id()` returns NULL when unset → zero rows | Must |
| Automated isolation tests for every table and endpoint (tenant A can't read/write tenant B) | Must |
| Cookies scoped to the exact host; no wildcard cookies across `*.remix.lk` | Must |
| Cache keys always include `tenantId` | Must |
| File paths in storage prefixed with `tenantId/`; signed URLs checked against tenant | Must |

### 5.3 Web application (OWASP Top 10)

| Item | Level |
| --- | --- |
| Zod validation on every input; reject unknown fields | Must |
| Parameterised queries only (Drizzle); no string-built SQL | Must |
| CSRF: `SameSite=Lax` host-only cookies + `Origin` / `Sec-Fetch-Site` verification on every state-changing request + JSON-only bodies ([ADR 0003](docs/decisions/0003-same-origin-api-via-edge-proxy.md)) | Must |
| CORS: none — the browser calls `/api/v1` same-origin on every host; the API sends no `Access-Control-Allow-*` headers ([ADR 0003](docs/decisions/0003-same-origin-api-via-edge-proxy.md)) | Must |
| XSS: React escaping; sanitize any rich text (DOMPurify on server); page-builder blocks store data, never raw HTML/JS | Must |
| Security headers on app (CSP with nonces, HSTS, frame-ancestors 'none' except where embedding is needed) | Must |
| SSRF: BYO SMS gateway URLs must be `https`, resolve to public IPs only (block 10/8, 172.16/12, 192.168/16, 127/8, 169.254/16, IPv6 private), no redirects, 5 s timeout | Must |
| Open redirects: only allow redirects to known tenant hosts | Must |
| Error messages never leak stack traces or SQL | Must |

### 5.4 Files, video and content

| Item | Level |
| --- | --- |
| Uploads: check real file type (magic bytes), size limits (slip 5 MB, PDF 50 MB), strip EXIF from images, reject SVG/HTML | Must |
| Private R2 buckets; signed URLs valid ≤ 10 min; never public listing | Must |
| Bunny: token authentication on every playback, referrer restriction to tenant hosts, MediaCage Basic, watermark with student ID | Must |
| PDF tutes watermarked per download in a worker | Should |
| Virus scan uploads (ClamAV in a worker) | Should |

### 5.5 Payments and integrations

| Item | Level |
| --- | --- |
| PayHere notify: verify `md5sig` with the merchant secret, check amount/currency/order id against our invoice, idempotent processing | Must |
| Never trust the browser redirect for "paid"; only the server-to-server notify | Must |
| Integration secrets (PayHere, SMS, Zoom tokens, Bunny keys) encrypted at rest (AES-256-GCM with a key from env/secret store), masked in UI | Must |
| Zoom OAuth tokens refreshed server-side, revoked on disconnect | Must |
| Webhook endpoints: signature check, replay protection (timestamp), idempotency keys | Must |

### 5.6 Infrastructure

| Item | Level |
| --- | --- |
| SSH keys only, no root login, non-default user, `unattended-upgrades` on | Must |
| Hetzner Cloud Firewall: 443 only from Cloudflare IP ranges; SSH only from team IPs or via Tailscale/WireGuard | Must |
| DB and Valkey on the private network only, strong passwords, TLS between nodes where possible | Must |
| Docker images: minimal base, run as non-root, scanned with Trivy in CI | Must |
| Secrets never in Git; `.env` files only on servers (or Kamal secrets); rotate on staff change | Must |
| Cloudflare WAF managed rules + rate limiting rules on login/OTP/payment paths | Must |
| Backups: encrypted, stored at another provider, 14-day point-in-time recovery, monthly restore drill | Must |

### 5.7 Code and supply chain

| Item | Level |
| --- | --- |
| Branch protection on `main`: PR + review + passing CI | Must |
| Dependabot (or Renovate) for dependencies; `pnpm audit` in CI | Must |
| Static analysis: Semgrep (free rules) in CI | Should |
| Secret scanning (GitHub secret scanning / gitleaks) in CI | Must |
| Lockfile committed; install with `--frozen-lockfile` | Must |

### 5.8 Privacy and compliance (Sri Lanka)

| Item | Level |
| --- | --- |
| Review the **Personal Data Protection Act No. 9 of 2022** with a lawyer: lawful basis, consent, cross-border storage (servers in EU), data-subject rights | Must |
| Parent/guardian consent for students under 18 | Must |
| Collect only needed data (no NIC unless required); retention periods; delete on institute exit after export | Must |
| Data Processing Agreement template for institutes (ReMix processes data on their behalf) | Must |
| Privacy policy + terms on remix.lk and on every institute site footer | Must |

### 5.9 Monitoring and incident response

| Item | Level |
| --- | --- |
| Sentry on site, web, api; uptime checks every minute on key URLs | Must |
| Alerts: 5xx spike, p95 > 500 ms, queue backlog, DB replication lag, disk > 80%, failed backup | Must |
| Audit log retention 1 year; security events (logins, role changes, impersonation) searchable | Must |
| Written incident plan: who is on call, how to notify institutes, status page, post-mortem within 5 days | Must |
| External pen test (or at least OWASP ZAP scan + manual review) before pilots | Should |

---

## 6. Reliability and budget

### 6.1 Environments

| Env | Where | Data |
| --- | --- | --- |
| Local | Docker Compose on laptop | Seed data |
| Preview | Cloudflare Pages previews (site); optional per-PR API later | Seed |
| Staging | 1 small Hetzner server (`staging.remix.lk`) | Anonymised copy |
| Production | Hetzner private network behind Cloudflare | Real |

### 6.2 Production layout by stage

| Stage | Servers | Approx. servers cost / month |
| --- | --- | --- |
| Pilots (≤ 5 institutes) | 1 app node (web + api + worker + Valkey), 1 DB node, continuous backups | ~€25 (≈ LKR 9,500) |
| Paying customers | Load balancer, 2 app nodes, 1 worker node, DB primary + standby (Patroni) or a managed Postgres, staging server | ~€80–110 (≈ LKR 30,000–42,000) |
| 100+ institutes | Cells of ~50 institutes, each with its own app + DB pair | Grows with revenue |

remix.lk on Cloudflare Pages: **free**. Video, SMS and OTP costs grow with students (see the profit plan).

### 6.3 Deploys without downtime

- Kamal deploys new containers, waits for `/health` to pass, then switches traffic; `kamal rollback` in under a minute.
- Migrations are backward-compatible (add columns first, remove later).
- No releases 6–9 pm on weekdays or Saturday mornings.
- Saturday peaks: add app nodes by the hour, remove after.

---

## 7. Git, CI/CD and quality

- **Branches:** `main` (always deployable), `feat/…`, `fix/…`; Conventional Commits; squash merge.
- **CI on every PR:** install → lint → typecheck → unit tests → build → Trivy (images) → Semgrep → gitleaks. Site PRs get a Cloudflare preview link.
- **Tests:** Vitest (unit), Supertest (API + tenant isolation), Playwright (E2E: site form, student pay → watch, admin approve slip), k6 (load).
- **Definition of Done:** reviewed PR · CI green · tests for new logic · RLS + isolation test for new tables · Zod validation · i18n keys · works at 390 px and on 3G throttling · no secrets in code/logs · docs/ADR updated.

---

## 8. Rules for AI assistants (copy into `CLAUDE.md`)

```
Project: ReMix — multi-tenant LMS SaaS for Sri Lankan tuition. Monorepo (pnpm + Turborepo).
Apps: site (remix.lk, static Next.js), web (tenant sites/portals, Next.js), api (NestJS). Packages: ui, db, types, config.
Visual source of truth: design/claude-design/*.dc.html. Theme tokens: packages/ui/theme.css. Never hard-code hex values.
Rules:
- TypeScript strict. Zod schemas from packages/types for all input/output.
- Every tenant table has tenant_id + RLS; tenant queries only via withTenant(). Never bypass RLS.
- Money = integer cents. Times stored UTC, shown Asia/Colombo.
- All UI text via i18n message files (en, si, ta).
- Slow work → BullMQ jobs. Integrations only through provider interfaces.
- Security: validate input, no raw SQL strings, no secrets in code, signed URLs for files, audit money/role changes.
- Do not add new dependencies or services without explaining why in the PR.
- Write tests with every feature; run lint, typecheck and tests before finishing.
```

---

## 9. Budget summary (monthly, early stage)

| Item | Cost |
| --- | --- |
| remix.lk hosting (Cloudflare Pages, Web Analytics, Turnstile) | Free |
| Domain remix.lk | Yearly fee (check current LK Domain Registry rates) |
| Email mailboxes (2–3 users) | Low monthly fee per user |
| Transactional email | Free tier at start |
| Sentry, GitHub, Cloudflare | Free tiers |
| Hetzner (pilot stage) | ~€25 |
| Bunny, Text.lk | Pay as you go, recovered through plans |

---

## 10. Your next 10 days

- [ ] Register `remix.lk`, move DNS to Cloudflare, set up `hello@` and `security@` mailboxes
- [ ] Create the GitHub repo and monorepo skeleton; add `design/claude-design/` with your exported files
- [ ] Build `packages/ui/theme.css` from `ReMix Brand.dc.html`
- [ ] Build Header, Footer, Logo, then the Home page
- [ ] Add `lib/pricing.ts` with tests; build the calculator
- [ ] Build Pricing, For Institutes, For Teachers, About, Guides
- [ ] Demo form with Turnstile + Pages Function
- [ ] SEO metadata, sitemap, security headers, security.txt
- [ ] Deploy to Cloudflare Pages; test on a low-end Android phone
- [ ] Start the Zoom app review and PDPA legal review in parallel (both take weeks)
