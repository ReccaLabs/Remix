# 01 · Product — vision, users, needs, scope

> Part of the [ReMix development plan](README.md). This file answers **who it's for, what they need, and what we build first**. Every feature in [02-features.md](02-features.md) traces back to a need ID here.

---

## 1. Vision

**ReMix lets a Sri Lankan tuition teacher or institute run the whole class — hall, Zoom and fee counter — from one system, without losing income to leaked lessons, shared accounts or unchased fees.**

Each institute gets its own branded site (`kamalphysics.remix.lk` or its own domain) with a public website, a student portal and an admin area. Recca Labs runs the platform (`admin.remix.lk`) and the sales site (`remix.lk`).

### Problems we exist to fix (from the design brief)

| # | Problem | What "fixed" looks like |
| --- | --- | --- |
| P1 | Lessons leaked to Telegram | Encrypted streaming + moving student-ID watermark; leaks are traceable to an account |
| P2 | One account, ten students | 2 devices per student; Zoom joins locked to the registered name |
| P3 | Chasing fees and bank slips | Card payments, slip upload from a phone, one-key approval, automatic unlock |
| P4 | Scattered tools (WhatsApp, Excel, Zoom, a website) | One system: website, students, fees, lessons, live classes, attendance, SMS |
| P5 | Foreign tools priced per class card | Pay per *active student*; one student counts once however many classes |

### Business model (source of truth: `packages/types/src/pricing.ts`)

- Plans: **Tutor** (1 teacher, ≤150 students), **Institute** (many teachers, ≤1,500), **Enterprise** (branches, 1,500+). Base fee + per-active-student fee. Lite (YouTube-only, ≤100) exists but isn't advertised.
- **Active student** = paid a fee *or* logged in during the 30-day billing cycle. Inactive students are free.
- Add-ons: ReMix+ offline gate, hardware DRM, SMS, white-label app, extra video.
- The institute collects student fees through **its own** PayHere merchant account — ReMix never holds institute money.

### Success metrics (what we measure after pilots)

| Metric | Target at 3 months after GA |
| --- | --- |
| Institutes live (paying) | ≥ 20 |
| Pilot → paid conversion | ≥ 80% |
| Fee collection rate per institute (paid ÷ invoiced by the 10th) | +10 pts vs their previous method |
| Bank slips approved within 2 working hours | ≥ 90% |
| Students who join live classes from the portal (not a shared link) | ≥ 95% of live attendance |
| Monthly logo churn | < 3% |
| P1/P2 incidents (data leak, payment error) | 0 |
| Support tickets per 100 active students per month | < 2 |

---

## 2. Users and roles

| ID | Persona | Where | Device reality | Main jobs |
| --- | --- | --- | --- | --- |
| **OWN** | Institute owner / head teacher (e.g. Kamal) | `/admin` | Laptop + phone, checks numbers between classes | See income, unpaid students, today's classes; set fees; manage staff; website |
| **ADM** | Institute admin / office staff | `/admin` | Office PC | Students, classes, timetable, messages, reports |
| **TCH** | Teacher (in a multi-teacher institute) | `/admin` (restricted) | Laptop | Upload lessons, schedule live classes, see own classes' attendance |
| **CSH** | Cashier | `/admin/fees` | Office PC, thermal printer, card scanner | Approve 50+ slips before Saturday class; cash counter with receipts |
| **GTE** | Gatekeeper | ReMix+ gate app | Cheap Android at the hall door | Scan cards, see paid/unpaid instantly, works offline |
| **STU** | Student (13–19) | Institute site, mobile-first | Low-end Android on mobile data; sometimes a shared laptop | Join live class, pay fee, watch lessons, download tutes |
| **PAR** | Parent / guardian | SMS today, parent view later | Basic phone or smartphone | Know if the child attended, what's owed, pay |
| **PST** | Recca Labs platform staff (support, sales, finance, super admin) | `admin.remix.lk` | Laptop | Onboard institutes, support (log in as admin), billing, health |
| **VIS** | Prospective student / parent | Institute public site | Phone | Find classes, timetable, fees, contact, enrol |

### Role permissions (deny by default; enforced in API guards **and** Postgres RLS)

| Capability | OWN | ADM | TCH | CSH | GTE | STU | PST |
| --- | :-: | :-: | :-: | :-: | :-: | :-: | :-: |
| Dashboard money figures | ✓ | ✓ | – | today only | – | – | via impersonation |
| Students: view / edit | ✓/✓ | ✓/✓ | own classes / – | view / – | – | self | via impersonation |
| Classes: create / edit | ✓ | ✓ | – / own | – | – | – | – |
| Fees: approve slips, cash, record payment | ✓ | ✓ | – | ✓ | – | – | – |
| Fees: edit fee amounts, waive, reverse payment | ✓ | – | – | – | – | – | – |
| Lessons: upload / publish | ✓ | ✓ | own classes | – | – | watch (paid) | – |
| Live classes: schedule | ✓ | ✓ | own classes | – | – | join (paid) | – |
| Attendance: scan / manual mark | ✓ | ✓ | own classes | – | scan | – | – |
| Messages (SMS) | ✓ | ✓ | own classes | receipts only | – | – | – |
| Website, domain, integrations, staff, subscription | ✓ | – | – | – | – | – | – |
| Platform: tenants, plans, suspend, impersonate | – | – | – | – | – | – | by staff role |

Owner, admin and cashier accounts require a second factor (SMS code; "trust this computer for 30 days"). Platform staff require Google Workspace SSO **plus** TOTP or a security key.

---

## 3. Needs (jobs-to-be-done) and "satisfied when"

Each need has testable acceptance signals. These become E2E journeys (see [04-quality.md §4](04-quality.md#4-test-strategy)).

### Institute owner / admin

| ID | Need | Satisfied when |
| --- | --- | --- |
| N-OWN-1 | Know where the money stands this month | Dashboard shows collected vs expected, unpaid count and slips waiting, correct to the minute, in < 2 s |
| N-OWN-2 | Move from my current system without retyping | CSV/Excel import of students + classes + enrolments with validation preview; 500 rows in < 1 min; errors downloadable |
| N-OWN-3 | Stop lessons being shared | Videos stream only to paid students, with a moving watermark; no download; 2-device limit enforced |
| N-OWN-4 | Run Zoom classes without link sharing | One-time Zoom connect; sessions auto-invite paid students with locked names; attendance appears after class |
| N-OWN-5 | Have my own website without a developer | Public site live on day 1 from my classes/timetable data; theme colour + logo; own domain later |
| N-OWN-6 | Reach parents and students quickly | SMS to a class, to unpaid students, or to parents of absentees in ≤ 3 clicks, with cost shown before sending |
| N-OWN-7 | Trust the system with my data and income | Data isolated per institute, audit log of money/role changes, Recca support access visible and recorded |
| N-OWN-8 | Control who on my staff can do what | Staff invite with roles; cashier can't change fees; teacher sees only own classes |
| N-OWN-9 | Understand trends | Income by class/month, attendance trends, unpaid list — exportable to CSV/PDF |

### Cashier

| ID | Need | Satisfied when |
| --- | --- | --- |
| N-CSH-1 | Clear the slip queue fast | Keyboard flow A/R/S; next slip loads automatically; ≥ 3 slips/minute sustained; duplicate references flagged |
| N-CSH-2 | Take cash at the counter without mistakes | Scan card or search → pick months → change calculated → receipt printed + SMS in < 30 s per student |
| N-CSH-3 | Never mark a paid student unpaid | Card, slip and cash all land in the same invoice ledger; one source of truth for "paid" |

### Teacher

| ID | Need | Satisfied when |
| --- | --- | --- |
| N-TCH-1 | Publish lessons with little effort | Drag-drop upload with progress, processing status, scheduled release, attach tute PDF |
| N-TCH-2 | Know who attended | Per-session attendance from Zoom and the gate in one list (present / late / left early / absent) |

### Gatekeeper

| ID | Need | Satisfied when |
| --- | --- | --- |
| N-GTE-1 | Let paid students in quickly, even offline | Scan → full-screen green/red/amber in < 1 s; works with no internet using the morning sync |

### Student

| ID | Need | Satisfied when |
| --- | --- | --- |
| N-STU-1 | Get into today's class with one tap | Home shows the live class with "Join"; opens Zoom with my name locked; join opens 10 min before start |
| N-STU-2 | Pay without going to the office | Pay by card (instant unlock) or upload a slip (unlock after approval, SMS when done); receipts downloadable |
| N-STU-3 | Watch lessons on a cheap phone and weak data | Adaptive 360p/480p/720p; resumes where I stopped; page usable at 360 px on 3G |
| N-STU-4 | Not get locked out unfairly | Clear device-limit screen letting me sign out another device myself; SMS code password reset |
| N-STU-5 | Use it in my language | Sinhala, Tamil or English, chosen per person, remembered |

### Parent

| ID | Need | Satisfied when |
| --- | --- | --- |
| N-PAR-1 | Know my child attended | SMS on absence (configurable per institute) |
| N-PAR-2 | Know what's owed | SMS reminder when a fee is due/overdue; later a parent view with attendance + payments |

### Prospective student / visitor

| ID | Need | Satisfied when |
| --- | --- | --- |
| N-VIS-1 | Find the right class and join | Public site lists classes (grade, medium, time, place, fee) → "Enrol" → register + pay first month online |

### Recca Labs staff

| ID | Need | Satisfied when |
| --- | --- | --- |
| N-PST-1 | Onboard a new institute in < 15 minutes | Create tenant, subdomain, plan, owner invite, sample data option; trial starts |
| N-PST-2 | Support without asking for passwords | "Log in as admin" with reason, 30-minute limit, owner emailed, banner shown, audit logged |
| N-PST-3 | Bill institutes correctly | Active students metered per cycle; invoice generated; failed payment → reminder → suspend flow |
| N-PST-4 | See platform health at a glance | MRR, active institutes/students, trials ending, video TB, API/video/SMS/PayHere health |

---

## 4. Scope

### 4.1 Releases

| Release | Purpose | Gate |
| --- | --- | --- |
| **R0 — remix.lk** ✅ | Sell: marketing site, demo/trial form | Shipped (Phase 0) |
| **R1 — Pilot MVP** | 3 pilot institutes run a full month (fees + lessons + live + attendance) on ReMix | Phase 8 exit criteria |
| **R2 — General availability** | Self-serve-ready for paying institutes; custom domains; page builder; parent view; reports | Phase 9 exit criteria |
| **R3+ — Growth** | ReMix+ gate app, mobile apps, white-label, exams, branches, hardware DRM | Per-feature |

### 4.2 MoSCoW for R1 (Pilot MVP)

**Must** — without these a pilot can't run a month:
- Tenant on a `*.remix.lk` subdomain; platform staff can create/suspend it and log in as admin
- Staff login + 2-step for owner/cashier; roles: owner, admin, teacher, cashier
- Student login (phone + password), SMS-code reset, 30-day sessions, **2-device limit**
- Students: add, CSV import, profile, devices, parent contact; student numbers (`BR-1042` style)
- Classes: create, schedule, fee, enrol/move students
- Fees: monthly invoices per enrolment, **PayHere card payments**, **bank-slip upload + approval queue**, **cash counter + printable receipts**, payment history, month **unlock rule**, reminders by SMS
- Lessons: **protected video (Bunny)** with watermark, YouTube free previews, PDF tutes, scheduled release, monthly access
- Live: **Zoom connect**, schedule (incl. repeat), auto-register paid students with locked names, join from portal, attendance import
- Attendance: Zoom + manual marking; absent SMS to parents
- SMS: ReMix wallet via Text.lk for OTP, receipts, reminders, absences; balance + top-up by staff
- Public site: template from institute data (hero, about, classes, timetable, contact) with logo + brand colour
- Admin dashboard, students/classes/fees/lessons/live screens as designed; mobile admin home
- ReMix billing: active-student metering + monthly platform invoice (manual payment collection acceptable for pilots)
- English UI complete; Sinhala/Tamil for the **student portal** reviewed by native speakers

**Should** (R1 if time allows, else R2):
- QR student card + hall QR attendance (web scanner, online only)
- Bank-slip amount reading (OCR assist) — fallback: student enters amount
- PDF tute watermarking per download
- Recording → lesson automatically
- Announcements on student home and public site
- Reports: income by class/month, attendance trend, CSV export

**Could** (R2): page builder (Puck), custom domains, own SMS gateway, own Bunny account, parent view, online enrolment from the public site, results/marks, Sinhala/Tamil admin UI.

**Won't (in R1/R2)**: native mobile apps, white-label app, hardware DRM, offline gate app (ReMix+), multi-branch, LMS quizzes/exams engine, payroll, timetable optimisation, marketplace.

### 4.3 Explicit non-goals

- ReMix is not a payment processor: student fees go directly to the institute's PayHere merchant.
- Not a general LMS (SCORM, course marketplaces). It's a tuition-class operating system.
- No social features (chat, comments) in R1/R2 — moderation burden and minors' safety.
- No AI-generated Sinhala/Tamil copy in the product.

---

## 5. Assumptions and constraints

| Type | Item |
| --- | --- |
| Team | 2–3 full-stack developers + part-time designer + AI coding assistants; Recca Labs staff for support/sales. Estimates in [05-roadmap.md](05-roadmap.md) assume this. |
| Budget | Pilot infra ≈ €25/month; paying stage ≈ €80–110/month (DEVELOPMENT.md §6). Free tiers first. |
| Legal | PDPA No. 9 of 2022 (Sri Lanka); students are often minors → guardian consent; data hosted in the EU → cross-border clause. Lawyer review before pilots. |
| Third parties | PayHere merchant onboarding is per institute and takes days; Zoom Marketplace app review takes weeks → start early. Bunny Stream, Text.lk, Resend, Cloudflare accounts. |
| Peak load | Saturday 6–9 AM and 6–9 PM: thousands of students logging in within minutes. Design target: 4,000 logins in 2 minutes per cell. |
| Devices | Low-end Android (2–3 GB RAM), Chrome; mobile data; 360 px width minimum. |
