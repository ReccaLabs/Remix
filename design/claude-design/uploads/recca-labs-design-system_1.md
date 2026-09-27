# ReMix — Design Guide & UI Plan

> Brand, design system, and screen plan for the ReMix marketing site (`remix.lk`), the Recca Labs platform admin (`admin.remix.lk`), each institute's admin dashboard (`/admin`) and the student portal.
> Pair this with `REMIX_PROJECT_START.md`. Build components once in `packages/ui` (shadcn/ui + Tailwind) and reuse them in every area.

---

## 1. Design goals

1. **Trust first.** Institutes hand us their income and their students' data. The UI must feel calm, precise and honest — no flashy gradients on money screens, no fake testimonials.
2. **Fast for busy people.** A cashier approves 50 bank slips before a Saturday class; a teacher checks unpaid students between sessions. Every common task ≤ 3 clicks, keyboard-friendly, dense tables.
3. **Works on a cheap phone.** Students use low-end Android on 3G/4G data packs. Student screens are mobile-first, light (< 200 KB JS per route target), 360 px wide minimum.
4. **Three languages from day one.** English, Sinhala, Tamil. Layouts must survive longer Sinhala/Tamil words.
5. **One system, three moods.** Marketing site = confident and warm. Admin areas = quiet and dense. Student portal = friendly and simple. Same tokens and components underneath.

---

## 2. Brand

| Item | Decision |
| --- | --- |
| Name | ReMix (product) · by Recca Labs (company) |
| Personality | Reliable, local, modern, fair-priced. "Built for Sri Lankan tuition, not adapted from abroad." |
| Voice | Short, plain sentences. Numbers over adjectives ("Save LKR 44,000 a month", not "huge savings"). Sinhala/Tamil copy written by native speakers, not machine-translated. |
| Logo idea | Wordmark "ReMix" with the **X** as two crossing strokes (blue + amber) — the "mix" of online and physical classes. Works as a 1-colour favicon "X". |
| Taglines (test these) | "Run your whole class, online and in the hall." · "Your class. Your website. Your students — protected." |

---

## 3. Design tokens

### 3.1 Colour

| Token | Light | Dark | Use |
| --- | --- | --- | --- |
| `--brand` | `#2B4BF2` | `#6F86FF` | Primary buttons, links, active nav |
| `--brand-soft` | `#EEF1FF` | `#1C2254` | Selected rows, soft badges |
| `--accent` | `#F2A516` | `#F7B940` | Highlights, marketing accents, "new" badges (sparingly) |
| `--ink` | `#0E1525` | `#EEF1F7` | Main text |
| `--muted` | `#5B6478` | `#9AA3B5` | Secondary text |
| `--line` | `#E4E7EE` | `#262D3D` | Borders, dividers |
| `--surface` | `#FFFFFF` | `#121826` | Cards, tables |
| `--canvas` | `#F6F7FA` | `#0B0F19` | App background |
| `--success` | `#12A150` | `#3CCB7F` | Paid, present, active |
| `--warning` | `#D98A00` | `#F2B233` | Pending slip, trial ending |
| `--danger` | `#D92D20` | `#F97066` | Unpaid, suspended, delete |
| `--info` | `#0B84D9` | `#4FB3F5` | Neutral notices |

Rules: brand blue for actions only; status colours only for status; every status also has an icon or word (never colour alone); text contrast ≥ 4.5:1.

Institutes override **only** `--brand` (and optionally `--accent`) with their own colours on their site and portal; everything else stays ReMix so quality is consistent.

### 3.2 Typography

| Role | Font | Size / line height | Weight |
| --- | --- | --- | --- |
| Latin UI + body | Inter (or Geist) | 14/20 admin, 16/24 portal & marketing | 400/500/600 |
| Sinhala | Noto Sans Sinhala | +1 px vs Latin, line height +4 px | 400/600 |
| Tamil | Noto Sans Tamil | +1 px vs Latin, line height +4 px | 400/600 |
| Numbers (money, counts) | Inter with `font-variant-numeric: tabular-nums` | — | 500/600 |
| Marketing display | Inter Display / Geist, 48–64 px, tight tracking (-2%) | — | 700 |

Scale: 12 · 13 · 14 · 16 · 18 · 20 · 24 · 30 · 36 · 48 · 64.

### 3.3 Space, radius, shadow

- Spacing: 4-px base → 4, 8, 12, 16, 20, 24, 32, 40, 48, 64, 96.
- Radius: 6 (inputs, badges), 10 (cards, buttons), 16 (marketing cards, modals), full (avatars, pills).
- Shadow: almost none in admin (borders instead); soft `0 8px 30px rgba(14,21,37,.08)` for marketing cards and popovers.
- Layout: admin content max width 1440 px; marketing max width 1200 px; 12-column grid, 24-px gutters (16 px on mobile).

### 3.4 Icons & imagery

- Icons: Lucide (ships with shadcn/ui), 16 px in tables, 20 px in nav.
- Photography: real Sri Lankan classrooms, halls, teachers and students (with consent), warm daylight. Avoid generic stock "diverse laptop" photos.
- Illustrations: simple line + flat fill in brand blue/amber for empty states (no classes yet, no payments yet).

---

## 4. Core components (`packages/ui`)

| Group | Components |
| --- | --- |
| Layout | AppShell (sidebar + topbar), PageHeader (title, breadcrumbs, primary action), Section, Card, Tabs |
| Data | DataTable (sort, filter, column toggle, bulk select, sticky header, CSV export), StatCard (value, delta, sparkline), Empty state, Skeleton loaders |
| Forms | Input, Select, Combobox (search students), DatePicker, MonthPicker (fees), Money input (LKR), Phone input (+94), FileDrop (bank slip, video), Switch, Form with Zod errors |
| Feedback | Toast, Alert banner, Confirm dialog (type the name to delete), Progress (video upload), Status badge (Paid/Unpaid/Pending/Suspended) |
| Navigation | Sidebar with collapsible groups, Command palette (`Ctrl/Cmd + K`: jump to student, class, page), Tenant switcher (platform staff only) |
| Special | Impersonation banner ("Recca support is viewing Kamal Physics — End session"), Video player with watermark layer, QR scanner, Language switcher (EN / සිං / த) |

---

## 5. UI plan by area

### 5.1 Marketing site — `remix.lk`

**Audience:** tuition teachers and institute owners (often deciding on a phone at night). **Goal:** book a demo or start a free trial.

Pages:

| Page | Purpose |
| --- | --- |
| Home | Hook → proof → features → pricing → CTA |
| Pricing | Plans + **cost calculator** ("students × classes → your Edumix-style bill vs ReMix") |
| Features | Sub-pages: Online classes & video protection · Fees & payments · Attendance & ReMix+ gate · Your own website · Parent app |
| For teachers / For institutes | Same product, two stories and two price anchors |
| Customers | Case studies from pilots (real numbers, real names with permission) |
| Blog / Guides | SEO: "How to start an online tuition class in Sri Lanka", "Stop Zoom link sharing" |
| Book a demo / Start free | Short form: name, phone, WhatsApp, number of students |
| Find your class | Search box → takes a student to their institute's site (students will land on remix.lk by mistake) |

Home page sections (top → bottom):

1. **Top bar:** logo · Features · Pricing · Customers · Login (Find your class) · **Start free** button.
2. **Hero:** headline "Run your whole class — online and in the hall." Sub: "Website, fees, protected video, Zoom and attendance for Sri Lankan tuition. From LKR 45 per student." CTAs: Start free · Book a demo. Visual: laptop with institute dashboard + phone with student portal.
3. **Trust strip:** pilot institute logos, "Built in Sri Lanka", PayHere / Bunny / Zoom partner marks (only where allowed).
4. **Problems we fix:** 3 cards — "Lessons leaked to Telegram" · "One account, ten students" · "Chasing fees and bank slips".
5. **Feature blocks:** alternating image/text: Your own website · Fees & bank slips · Protected video with watermark · Zoom with name lock · Offline gate attendance.
6. **Pricing calculator:** sliders for students and classes per student; shows ReMix monthly price vs a per-class-card model.
7. **Screens tour:** tabs (Admin · Student · Parent) with real screenshots.
8. **Testimonials:** only real quotes after pilots (leave out until then).
9. **FAQ:** data safety, moving from another system, payment methods, languages.
10. **Final CTA + footer:** contact, WhatsApp, address, privacy policy, terms, language switcher.

### 5.2 Platform admin — `admin.remix.lk` (Recca Labs staff)

**Style:** darker sidebar to feel distinct from institute admin (so staff always know where they are). Dense, keyboard-first.

| Nav | Screens |
| --- | --- |
| Overview | KPIs: MRR, active institutes, active students, trials ending this week, video TB this month, error rate. Charts: MRR over time, new institutes per week. Lists: trials ending, overdue payments. |
| Institutes | Table: name, plan, status, active students, MRR, domain, created, health. Filters by plan/status. Row → Institute detail. |
| Institute detail | Tabs: Overview · Plan & billing · Domains · Usage (students, video GB, storage, SMS) · Features (toggles) · Staff · Audit log. Actions: **Log in as admin**, Suspend/Reactivate, Change plan. |
| Billing | ReMix invoices to institutes, payments, overdue list, SMS wallet top-ups |
| Domains | All subdomains/custom domains, SSL status, pending verifications |
| Support | Impersonation sessions log (who/when/why), notes per institute |
| Announcements | Compose banner/notice for all or selected institutes |
| Staff & security | Platform staff, roles, 2FA status |
| System | Queue backlog, error spikes (Sentry link), backups status |

### 5.3 Institute admin — `<institute-domain>/admin`

**Users:** owner, admin, teacher, cashier, gatekeeper (nav items shown by role).

| Nav | Key screens & actions |
| --- | --- |
| Dashboard | Today's classes (time, hall/online, expected vs present), this month's collected vs expected fees, unpaid students count, **bank slips waiting** (big action card), recent payments, quick actions (Add student · Record payment · Upload lesson) |
| Students | Table with search by name/phone/student no.; filters by class, paid/unpaid, grade; bulk import CSV; student profile (classes, payments, attendance, devices, parent) |
| Classes | Class cards/table; class detail tabs: Students · Schedule · Lessons · Fees · Attendance |
| Fees & payments | Tabs: Invoices · Payments · **Bank slip queue** (image left, details right, Approve `A` / Reject `R` keyboard shortcuts) · Cash counter (cashier mode: search student → month → amount → print receipt) |
| Lessons | Upload video (progress, auto-processing), PDFs/tutes, per-class access by paid month, view counts |
| Live classes | Schedule Zoom sessions, join links, attendance from Zoom |
| Attendance | QR/ReMix+ scans, per-class reports, absent list → notify parents |
| Website | Theme (logo, colours), page builder (Puck), domain settings, preview/publish |
| Messages | SMS/notifications to class, unpaid students, parents; SMS balance |
| Reports | Income by class/month, attendance trends, export CSV/PDF |
| Settings | Institute profile, staff & roles, payment methods, receipt template, subscription & bill |

### 5.4 Student portal — `<institute-domain>` (mobile-first)

Bottom tab bar on mobile: **Home · Classes · Pay · Live · Me**.

- **Home:** next class card (time, join button when live), fees due banner, new lessons.
- **Classes:** my classes → lessons list (locked icon if month unpaid) → video player with watermark → tutes download.
- **Pay:** unpaid months, pay with card (PayHere) or upload bank slip; payment history and receipts.
- **Live:** today's live sessions, "Join" opens Zoom with locked name.
- **Me:** profile, devices (log out other device), language, parent link code.

Parent view (later): child switcher, attendance alerts, fees, results.

---

## 6. Interaction & content rules

- **Money:** always `LKR 2,500.00` style, tabular numbers, right-aligned in tables.
- **Dates:** `Sat, 26 Sep 2026 · 8:00 AM` in Asia/Colombo time; months as `Oct 2026` for fees.
- **Empty states:** explain + one action ("No classes yet — Create your first class").
- **Destructive actions:** confirm dialog; deleting an institute or class requires typing its name.
- **Loading:** skeletons, not spinners, for tables and cards.
- **Errors:** say what happened and what to do ("Payment failed at the bank. No money was taken. Try again or upload a bank slip.").
- **Accessibility:** focus rings visible, all actions reachable by keyboard, touch targets ≥ 44 px on mobile, `prefers-reduced-motion` respected.
- **Performance budget (student portal):** LCP < 2.5 s on a mid-range Android over 4G; images WebP/AVIF; no heavy chart libraries on student routes.

---

## 7. Design inspiration (what to borrow, not copy)

| Source | Borrow | Where it applies |
| --- | --- | --- |
| [Stripe Dashboard](https://stripe.com) | Money tables, payment detail layout, calm status badges | Fees & payments, platform billing |
| [Linear](https://linear.app) | Keyboard shortcuts, command palette, dense but quiet lists | Both admin areas |
| [Vercel](https://vercel.com) | Domain setup flow (add → DNS record → verified), deployment-style status | Website → Domain settings, platform Domains |
| [Shopify admin](https://www.shopify.com) | Merchant-style "run your business" home, theme editor + preview | Institute Dashboard, Website builder |
| [Kajabi](https://kajabi.com) / [Teachable](https://teachable.com) | Creator-site templates, course pages, pricing presentation | Institute home-page blocks, marketing pricing page |
| [Notion](https://www.notion.so) | Friendly empty states, simple typography | Onboarding, empty states |
| [shadcn/ui](https://ui.shadcn.com) | Base components and dashboard examples | `packages/ui` foundation |
| Local context | WhatsApp-first contact, Sinhala/Tamil typography, bank-slip culture, hall timetables | Every area — this is what foreign tools miss |

Also study (as a user, not to copy): the current Sri Lankan LMS products' student and admin flows, and note where teachers complain (Facebook groups of tuition teachers are a good source).

---

## 8. Design deliverables & order

| # | Deliverable | Needed by |
| --- | --- | --- |
| 1 | Tokens + core components in `packages/ui` | Sprint 0 |
| 2 | Institute admin: Dashboard, Students, Bank slip queue | Sprint 1–2 |
| 3 | Student portal: Home, Class → Lesson player, Pay | Sprint 2–3 |
| 4 | Platform admin: Overview, Institutes, Institute detail | Sprint 1 (basic) |
| 5 | Website builder blocks (hero, teacher, classes, timetable, contact) + 2 starter templates | Sprint 4 |
| 6 | Marketing home + pricing calculator | Before pilot launch |
| 7 | Sinhala/Tamil pass on all screens | Before pilot launch |

Test each screen with one real teacher and one cashier before building the next set.
