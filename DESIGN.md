# ReMix — Design System & UI Map

> How the Claude Design files become code. Read this before building or changing any screen.
>
> - **Visual source of truth:** [`design/claude-design/*.dc.html`](design/claude-design/) (open in a browser; `support.js` renders them).
> - **Design brief & rules:** [`design/claude-design/uploads/`](design/claude-design/uploads/) — `REMIX_CLAUDE_DESIGN_BRIEF.md`, `recca-labs-design-system_1.md`, `REMIX_LMS_SCREENS_PROMPTS.md`.
> - **Tokens in code:** [`packages/ui/src/theme.css`](packages/ui/src/theme.css) (Tailwind v4 `@theme`). Components never contain hex values — ESLint blocks them.

---

## 1. Principles

1. **Trust first.** Institutes hand us their income and their students' data. Calm, precise, honest. No flashy gradients on money screens, no fake testimonials, logos or numbers.
2. **Fast for busy people.** Common tasks ≤ 3 clicks, keyboard shortcuts in admin, dense tables.
3. **Works on a cheap phone.** Student screens are mobile-first, 360 px minimum, < 200 KB JS per route, LCP < 2.5 s on 4G.
4. **Three languages from day one.** English, Sinhala, Tamil. Layouts must survive longer Sinhala/Tamil words.
5. **One system, three moods** — same tokens and components underneath:

| Area | Where | Mood | Background | Body size |
| --- | --- | --- | --- | --- |
| Marketing site | `remix.lk` (`apps/site`) | Confident, warm, editorial | `paper` #FBFAF7 | 16/24 |
| Institute admin | `<tenant>/admin` (`apps/web`) | Quiet, dense, light | `canvas` #F6F7FA | 14/20 |
| Platform admin | `admin.remix.lk` (`apps/web`) | Dense, precise, **dark sidebar** | `canvas` + `night` sidebar | 14/20 |
| Student portal | `<tenant>` (`apps/web`) | Friendly, simple, big tap targets | `canvas` | 16/24 |

---

## 2. Tokens

All tokens are defined once in `packages/ui/src/theme.css` and exposed as Tailwind utilities (`bg-brand`, `text-muted`, `border-line-warm`, `rounded-card`, `shadow-card`…).

### 2.1 Colour

| Token (Tailwind) | Light | Use |
| --- | --- | --- |
| `brand` | `#2B4BF2` | Primary buttons, links, active nav. **Actions only.** |
| `brand-hover` | `#2140DB` | Hover of primary |
| `brand-soft` | `#EEF1FF` | Selected rows, soft badges, icon tiles, pricing band |
| `brand-line` | `#C9D1F5` | Borders on `brand-soft` surfaces (calculator pills) |
| `brand-on-dark` | `#6F86FF` | Brand on `night` backgrounds (logo stroke) |
| `accent` | `#F2A516` | Amber stroke of the X. Highlights, sparingly, marketing only |
| `accent-soft` / `accent-ink` | `#FDF1D8` / `#8A5200` | "New" badges (ink on soft passes AA) |
| `accent-tint` / `accent-line` | `#FFF8EB` / `#F3D59B` | Fee-due banners, "bank slips waiting" card |
| `accent-on-dark` | `#F7B940` | Numbers on the dark problems band |
| `ink` | `#0E1525` | Main text, dark bands, footer |
| `ink-2` | `#3A4357` | Body copy on marketing, nav links |
| `muted` | `#5B6478` | Secondary text |
| `line` / `line-soft` | `#E4E7EE` / `#EEF0F4` | App borders / table row dividers |
| `line-strong` | `#8A93A6` | Form-control borders (≥ 3:1 against white, WCAG 1.4.11) |
| `surface` | `#FFFFFF` | Cards, tables |
| `canvas` | `#F6F7FA` | App background |
| `paper` · `paper-2` · `paper-3` | `#FBFAF7` · `#F1EFE9` · `#F7F5F0` | Marketing background · outline hover / segmented track · mockup chrome |
| `line-warm` / `line-warm-soft` | `#E1DDD3` / `#ECE9E2` | Marketing borders / header border |
| `night` · `night-2` · `night-line` · `night-muted` | `#0E1525` · `#121A2B` · `#262D3D` · `#B5BCCB` | Dark bands, footer, platform sidebar |
| `success` (+`-soft`, `-ink`, `-on-dark`) | `#12A150` | Paid, present, active. `success-on-dark` #3CCB7F for checks on `night` cards |
| `warning` (+`-soft`) | `#D98A00` | Pending slip, trial ending |
| `danger` (+`-soft`, `-ink`) | `#D92D20` | Unpaid, suspended, delete |
| `info` (+`-soft`) | `#0B84D9` | Neutral notices |

**Rules**
- Brand blue is for actions. Status colours are for status only.
- **Status is never colour alone** — always a word and/or icon (`Paid ✓`, `Unpaid`, `Pending`).
- Text contrast ≥ 4.5:1. Use the `-ink` variants for text on `-soft` backgrounds.
- Dark mode (product apps only) overrides the semantic tokens under `.dark` in `theme.css`. `remix.lk` is light-only, as designed.

### 2.2 Tenant theming

Institutes override **only** `--color-brand`, `--color-brand-hover`, `--color-brand-soft` (and optionally `--color-accent`) on their site and portal, set as inline CSS variables on `<html>` from the tenant record. Everything else stays ReMix so quality is consistent. Validate tenant colours server-side (hex format, contrast ≥ 4.5:1 against white for buttons) before saving.

### 2.3 Typography

| Role | Font | Tailwind | Notes |
| --- | --- | --- | --- |
| Display (marketing headlines, logo) | Bricolage Grotesque 600–800 | `font-display` | Tight tracking. Use `<DisplayHeading>` |
| UI & body | Geist 400/500/600 | `font-sans` (default) | 16/24 marketing & portal, 14/20 admin |
| Code, URLs, sample IDs | Geist Mono | `font-mono` | |
| Sinhala | Noto Sans Sinhala | `font-sinhala` / automatic via `:lang(si)` | +1 px size, +4 px line-height → use `si:` variant |
| Tamil | Noto Sans Tamil | `font-tamil` / automatic via `:lang(ta)` | Same rule → `ta:` variant |
| Money & counts | Geist + `tabular` utility | `tabular` | Right-aligned in tables |

Marketing display scale (desktop → responsive steps are built into `DisplayHeading`):

| Token | Size / line-height / tracking | Used for |
| --- | --- | --- |
| `text-display-xl` | 66 / 1.0 / -0.035em, 800 | Home hero H1 |
| `text-display-lg` | 52 / 1.04 / -0.035em, 800 | Final CTA |
| `text-display` | 46 / 1.05 / -0.03em, 700 | Section titles |

General scale: 12 · 13 · 14 · 16 · 18 · 20 · 24 · 30 · 36 · 48 · 64. Fonts are self-hosted with `next/font` (no runtime Google request).

### 2.4 Space, radius, shadow, layout

- **Spacing:** 4 px base → 4, 8, 12, 16, 20, 24, 32, 40, 48, 64, 96. Marketing sections use `py-16 sm:py-24` (64 → 96 px).
- **Radius:** `rounded-xs` 6 (inputs, badges) · `rounded-md` 10 (buttons, app cards) · `rounded-lg` 14 (mockup frames) · `rounded-card` 16 (marketing cards, modals) · `rounded-band` 24 (marketing bands) · `rounded-full` (pills, avatars).
- **Shadow:** admin uses borders, almost no shadow. `shadow-card` for marketing cards/popovers; `shadow-card-strong` for the highlighted plan card; `shadow-float` for phone mockups; `shadow-seg` for the active segmented tab.
- **Containers:** `max-w-marketing` 1200 px, `max-w-app` 1440 px. Gutters 24 px (16 px on mobile) — `<Container>` does this.
- **Breakpoints we design and test at:** 390 (phone) · 768 (`md`) · 1024 (`lg`) · 1440. The marketing header adds a custom 1100 px step (full nav), as in the design.

### 2.5 Icons & imagery

- **Icons:** Lucide (`lucide-react`, tree-shaken SVG — not the CDN masks used in the design files). 1.5–2 px stroke. 16 px in tables, 18–20 px in nav, 22 px in feature tiles. Decorative icons get `aria-hidden`.
- **No emoji** in UI.
- **Photography:** real Sri Lankan classrooms/halls/teachers with consent. No generic stock.
- **Product screenshots on remix.lk** are rendered from React mockups (`apps/site/src/components/mockups/`) using clearly sample data, so they stay crisp and on-brand.

---

## 3. Components

### 3.1 Built (`packages/ui`)

| Component | File | Notes |
| --- | --- | --- |
| `Logo` | `logo.tsx` | `variant`: wordmark · lockup ("by Recca Labs") · mark (app icon). `tone`: light · dark. Pure CSS, no image |
| `buttonClass()` | `button.ts` | Class helper → works on `<button>`, `<a>`, `<Link>`. Variants: primary · secondary · outline · ghost · dark · success · danger. Sizes: sm 36 · md 40 · lg 48 · xl 52 |
| `Button` | `actions/button.tsx` | `buttonClass` + `loading` (spinner, `aria-busy`); ≥ 44 px on touch |
| `Field`, `Input`, `PasswordInput`, `PhoneInput`, `Checkbox` | `forms/` | Field wires label/hint/error via `aria-describedby` + `aria-invalid`; PhoneInput announces the +94 prefix |
| `StatusBadge`, `EmptyState`, `Skeleton` | `feedback/` | Status always word + colour |
| `ToastProvider` / `useToast`, `ConfirmDialog` | `feedback/` | Client. Live region exists before the first toast; native `<dialog>` with focus return and type-to-confirm |
| `StatCard`, `DataTable` v1 | `data/` | Real table semantics, one tab stop with arrow-key rows, scroll region on phones. No sort/bulk select yet |
| `PortalShell`, `AdminShell`, `PlatformShell` | `shells/` | Sidebar ≥ 1024 px, bottom tabs below; skip link; `linkComponent` prop (no Next.js dependency); all copy via props |
| `Container` | `layout.tsx` | marketing (1200) / app (1440) widths with gutters |
| `DisplayHeading` | `layout.tsx` | Bricolage headings, sizes md/lg/xl, responsive |
| `Eyebrow` | `layout.tsx` | Small blue label above section titles |
| `IconTile` | `layout.tsx` | 44 px icon square, brand or accent tone |
| `Badge` | `layout.tsx` | "New" pill; accent/brand/ink tones |
| `cn()` | `cn.ts` | clsx + tailwind-merge (aware of our custom text sizes) |
| `theme.css` | `theme.css` | Tokens, dark overrides, `si:`/`ta:` variants, `tabular`, focus ring, reduced-motion |

### 3.2 Built (`apps/site/src/components`)

| Folder | Components |
| --- | --- |
| `layout/` | `SiteHeader` (sticky, blurred), `NavLink` (active state), `MobileMenu` (< 1100 px), `LanguagePill` / `LanguageList`, `SiteFooter` |
| `home/` | `Hero`, `Problems`, `Features`, `PricingBand` + `PricingCalculator`, `ScreensTour` + `Tabs`, `Faq` (native `<details name>`), `FinalCta` |
| `mockups/` | `Scaled` (fixed-size render scaled by `--s`), `DashboardPreview` (1440×1000), `PhoneFrame`, `StudentPhone`, `ParentPhone` |
| `forms/` | `Input`, `AffixInput` (+94 prefix), `Label`, `FieldHint`, `FieldError`, `Checkbox`, `Select`, `Textarea`, `ErrorSummary` — the pattern the product forms will reuse |
| `pricing/` | Plan cards + billing toggle, bill calculator (sliders), active-students explainer, add-ons table, FAQ |
| `institutes/` · `teachers/` · `audience/` | Audience pages; `PlanExample` price card shared by both |
| `about/` · `guides/` | About sections; guide cards, featured guide, CSS-only topic filter. Articles are MDX in `src/content/guides/en/` |
| `demo/` · `find-class/` · `legal/` | Lead form with Turnstile, safe `*.remix.lk` class finder, long-form legal layout |

**Candidates to move into `packages/ui` next:** FAQ accordion (used on Home + Pricing), segmented toggle, range slider, form primitives.

### 3.3 Planned for the product (`packages/ui`, shadcn/ui-based)

| Group | Components |
| --- | --- |
| Layout | PageHeader (title, breadcrumbs, primary action), Section, Card, Tabs |
| Data | DataTable v2 (sort, filter, column toggle, bulk select, sticky header, CSV export) |
| Forms | Select, Combobox (student search), DatePicker, MonthPicker, MoneyInput (LKR), FileDrop, Switch |
| Feedback | AlertBanner, Progress |
| Navigation | Sidebar groups, Command palette (Ctrl/Cmd K), TenantSwitcher (platform staff) |
| Special | ImpersonationBanner, VideoPlayer with watermark layer, QR scanner, LanguageSwitcher |

---

## 4. Screen → route map

Every design file and where it lives in code. ✅ built · 🟡 in progress · ⬜ planned.

### 4.1 Company site — `remix.lk` → `apps/site/src/app/[locale]/…`

| Design file | Route | Status |
| --- | --- | --- |
| `ReMix Home.dc.html` | `/` | ✅ |
| `Pricing.dc.html` | `/pricing` | ✅ |
| `For Institutes.dc.html` | `/for-institutes` | ✅ |
| `For Teachers.dc.html` | `/for-teachers` | ✅ |
| `Guides.dc.html` | `/guides`, `/guides/[slug]` | ✅ |
| `About.dc.html` | `/about` | ✅ |
| (built from brand) | `/demo` (demo + trial form), `/find-your-class` | ✅ |
| (text pages) | `/privacy`, `/terms`, `/data-protection` | ✅ |
| `Site Header` / `Site Footer` / `ReMix Logo` / `ReMix Brand` | shared layout + `packages/ui` | ✅ |

### 4.2 Student portal — `<tenant-domain>` → `apps/web/src/app/(tenant)/(portal)/…` (Phase 2–3)

| Design file | Route |
| --- | --- |
| `Institute Public Site.dc.html` | `/` (tenant website, built from blocks) |
| `Student Login.dc.html` | `/login`, `/login/otp`, `/login/devices` |
| `Student Home.dc.html` | `/app` |
| `Student Classes.dc.html` | `/app/classes`, `/app/classes/[classId]` |
| `Lesson Player.dc.html` | `/app/lessons/[lessonId]` |
| `Student Live.dc.html` | `/app/live` |
| `Student Pay.dc.html` | `/app/pay` |
| `Student Me.dc.html` | `/app/me` |

### 4.3 Institute admin — `<tenant-domain>/admin` → `apps/web/src/app/(tenant)/admin/…`

| Design file | Route |
| --- | --- |
| `Staff Login.dc.html` | `/admin/login` (+ 2-step code) |
| `Institute Dashboard.dc.html` / `Admin Dashboard Mobile.dc.html` | `/admin` |
| `Admin Students.dc.html` | `/admin/students`, `/admin/students/[id]` |
| `Admin Classes.dc.html` | `/admin/classes`, `/admin/classes/new`, `/admin/classes/[id]` (+ `/edit`), `/admin/classes/timetable` (week view, no design file yet: built from the Classes patterns) |
| *(no design file yet)* | `/admin/settings` (General), `/admin/settings/theme`, `/admin/settings/halls`, `/admin/settings/staff` |
| `Admin Lessons.dc.html` | `/admin/lessons` |
| `Admin Live Classes.dc.html` | `/admin/live` |
| `Admin Fees.dc.html` | `/admin/fees` (invoices · payments · bank-slip queue · cash counter) |
| `Admin Integrations.dc.html` | `/admin/settings/integrations` |

### 4.4 Platform admin — `admin.remix.lk` → `apps/web/src/app/(platform)/…`

| Design file | Route |
| --- | --- |
| `Staff Login.dc.html#15e` | `/login` (mandatory TOTP) |
| `Platform Admin.dc.html` | `/` overview, `/institutes`, `/institutes/[id]` |

---

## 5. Patterns & content rules

| Topic | Rule |
| --- | --- |
| **Money** | Stored as integer cents. Display `LKR 2,500.00` in the app (`formatLKR(c, { exact: true })`), `LKR 2,500` on marketing. Tabular figures, right-aligned in tables. Prices come only from `@remix/types/pricing`. |
| **Dates** | `Sat, 26 Sep 2026 · 8:00 AM`, Asia/Colombo. Fee months `Oct 2026`. Store UTC. |
| **Status** | Word + icon/dot + colour. Never colour alone. |
| **Empty states** | Explain + one action ("No classes yet — Create your first class"). |
| **Loading** | Skeletons, not spinners, for tables and cards. |
| **Errors** | Say what happened and what to do ("Payment failed at the bank. No money was taken. Try again or upload a bank slip."). |
| **Destructive** | Confirm dialog; deleting an institute or class requires typing its name. |
| **Accessibility** | Visible focus ring (global `:focus-visible`), everything keyboard-reachable, touch targets ≥ 44 px, `prefers-reduced-motion` respected (global), semantic headings, labelled landmarks, skip link. Prefer native elements (`<details>`, radio inputs) over ARIA re-implementations. |
| **Voice** | Short, plain sentences. Numbers over adjectives ("Save LKR 44,100 a month"). Sinhala/Tamil written by native speakers — never machine-translated. |
| **Honesty** | No lorem ipsum, fake testimonials, invented customer logos or made-up stats. Mockups use obviously sample data and are labelled "Sample data". Don't name competitors ("per-class-card pricing"). |
| **Motion** | Short (≤ 200 ms) colour/transform transitions only. No parallax, no autoplay. |
| **Performance** | Server Components by default. Client JS only for: header menu, calculator, tabs, forms. No chart libraries on student routes. Images AVIF/WebP with width/height. |

---

## 6. Implementing a screen from a `.dc.html` file

1. Open the design file in a browser (it renders via `support.js`) and read its markup. Style values are inline; props/state are in the `<script type="text/x-dc">` block at the bottom.
2. Map every inline style to a token/utility (§2). If a value has no token, it's either a one-off layout number (use an arbitrary value like `h-[68px]`) or a missing token — **add it to `theme.css`**, never inline a hex.
3. Split the page into sections → one Server Component per section in `components/<page>/`. Reuse `packages/ui` primitives. Interactive bits become small `'use client'` islands that receive server-rendered children/props.
4. Put all visible text in `messages/en/<namespace>.json` (use `t.rich` for inline emphasis/links). Decorative mockup sample data is the only exception.
5. Make it responsive: the design files are 1440 px desktop frames; build mobile-first and check 390 · 768 · 1024 · 1440.
6. Add `generateMetadata` with `pageMetadata()` (canonical + hreflang), and JSON-LD where useful.
7. Compare side by side with the design file at each width before opening the PR.

### Review checklist (every UI PR)

- [ ] Matches the design at 390 / 768 / 1024 / 1440
- [ ] No hex colours, no inline styles except geometry that can't be a class
- [ ] All text in message files; headings in order; landmarks labelled
- [ ] Keyboard: tab order, focus visible, Escape closes overlays
- [ ] Touch targets ≥ 44 px on mobile; contrast ≥ 4.5:1
- [ ] Status shown with a word/icon, not colour alone
- [ ] Money formatted with `formatLKR`, prices from `@remix/types`
- [ ] No new client component unless it needs state/events
