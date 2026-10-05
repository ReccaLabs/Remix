# 02 · Features & business rules

> Part of the [ReMix development plan](README.md). Every feature has an ID (`MOD-NN`), traces to a need in [01-product.md §3](01-product.md#3-needs-jobs-to-be-done-and-satisfied-when), a design screen in `design/claude-design/`, and a release (R1 = pilot MVP, R2 = GA, R3 = growth). Acceptance criteria here are the contract for the story's Definition of Done.

Legend — **Rel**: R1 Must · R1s Should · R2 · R3.

---

## Modules at a glance

| Code | Module | Owner app | Release |
| --- | --- | --- | --- |
| [TEN](#ten--tenancy--domains) | Tenancy, domains, theming | api + web | R1 (custom domains R2) |
| [AUTH](#auth--identity-sessions-devices) | Identity, sessions, devices, 2-step | api + web | R1 |
| [STF](#stf--staff--roles) | Staff & roles | api + web | R1 |
| [STU](#stu--students) | Students, import, profile, guardians | api + web | R1 |
| [CLS](#cls--classes--enrolment) | Classes, schedules, halls, enrolment | api + web | R1 |
| [FEE](#fee--fees--payments) | Invoices, PayHere, slips, cash, receipts, unlock | api + web | R1 |
| [LES](#les--lessons--video) | Lessons, protected video, YouTube, tutes | api + web | R1 |
| [LIV](#liv--live-classes-zoom) | Zoom connect, sessions, join, recordings | api + web | R1 |
| [ATT](#att--attendance) | Attendance (Zoom, manual, QR, gate) | api + web (+ gate app R3) | R1 / R1s / R3 |
| [MSG](#msg--messages--notifications) | SMS wallet, BYO gateway, notifications, announcements | api + web | R1 (BYO R2) |
| [WEB](#web--institute-public-website) | Public site, page builder, enrolment | web | R1 template / R2 builder |
| [RPT](#rpt--reports) | Reports & exports | api + web | R1s / R2 |
| [SET](#set--settings--integrations) | Settings, integrations, receipts, subscription | api + web | R1 |
| [PLT](#plt--platform-admin) | Platform admin (Recca Labs) | web `(platform)` + api | R1 core / R2 full |
| [BIL](#bil--remix-billing) | Metering, plans, platform invoices | api + worker | R1 |
| [PAR](#par--parents) | Parent contacts, parent view | api + web | R1 SMS / R2 view |
| [DAT](#dat--data-import-export--lifecycle) | Import, export, retention, deletion | api + worker | R1 |
| [GTE](#gte--remix-gate-app) | ReMix+ offline gate app | apps/gate (Expo) | R3 |

---

## TEN — Tenancy & domains

| ID | Feature | Screen | Needs | Rel |
| --- | --- | --- | --- | --- |
| TEN-01 | Resolve tenant from `Host` (`<slug>.remix.lk` or verified custom domain); unknown host → 404 | — | N-OWN-7 | R1 |
| TEN-02 | Tenant record: name, slug, status (trial/active/past_due/suspended/cancelled), plan, timezone, locale default, student-number prefix | Platform Admin 14b | N-PST-1 | R1 |
| TEN-03 | Theme: logo, brand colour (validated contrast), favicon; applied as CSS variables on public site, portal and admin | Institute Public Site, Integrations | N-OWN-5 | R1 |
| TEN-04 | Custom domain: add → CNAME/TXT instructions → verification → SSL active → primary/redirect | Platform 14b "Domains" | N-OWN-5 | R2 |
| TEN-05 | Feature flags per tenant (live classes, protected video, own SMS gateway, own Bunny, custom domain, page builder), defaulted from plan | Platform 14b "Features" | N-PST-1 | R1 |
| TEN-06 | Suspended tenant: public site shows a neutral "temporarily unavailable"; staff can log in to see billing only; students blocked with a clear message | — | N-PST-3 | R1 |

**Acceptance (TEN-01):** a request for tenant A's host can never read tenant B data — enforced by RLS even if application code forgets a filter (isolation test suite proves it per table).

---

## AUTH — Identity, sessions, devices

| ID | Feature | Screen | Needs | Rel |
| --- | --- | --- | --- | --- |
| AUTH-01 | Student login: phone (+94) + password; "Stay signed in for 30 days" | Student Login 1a/1d | N-STU-4 | R1 |
| AUTH-02 | Forgot password via 6-digit SMS code (resend timer 45 s; 3 codes / 15 min) | Student Login 1b | N-STU-4 | R1 |
| AUTH-03 | **2-device limit**: 3rd device sees the device list and can sign one out to continue | Student Login 1c | N-OWN-3, N-STU-4 | R1 |
| AUTH-04 | Student "Me": devices list with sign-out, change password, language | Student Me 16a/b | N-STU-4/5 | R1 |
| AUTH-05 | Staff login: phone or email + password; 2-step SMS code for owner/admin/cashier; "trust this computer 30 days" | Staff Login 15a–d | N-OWN-7 | R1 |
| AUTH-06 | Platform staff login: Google Workspace SSO + TOTP or security key (WebAuthn); every sign-in recorded | Staff Login 15e–g | N-PST-2 | R1 |
| AUTH-07 | First-login flows: staff invite link (expires 72 h), student first password set via SMS code | — | N-OWN-2 | R1 |
| AUTH-08 | Admin can sign out a student's devices (single or bulk), reset password (sends SMS code) | Admin Students 12a/12c | N-OWN-3 | R1 |
| AUTH-09 | Rate limits & lockout: login 5/min/phone + 20/min/IP; lockout → SMS unlock; OTP 3/15 min/phone | — | N-OWN-7 | R1 |

**Business rules**
- A device = a session bound to a device fingerprint label (UA-derived name like "Samsung Galaxy A14 · Chrome") + random device id cookie. Max **2 active devices per student**; staff are not device-limited but see their sessions.
- Session: short access (15 min) + rotating refresh token in `HttpOnly; Secure; SameSite=Lax` host-only cookie; 30-day refresh when "stay signed in", else 12 h. Password change revokes all sessions.
- Signed-out-by history is kept (device limit / student / staff name) — shown on Admin Students 12c.
- The same phone may be a student at two institutes: they are **separate accounts** (identity is tenant-scoped).

---

## STF — Staff & roles

| ID | Feature | Screen | Rel |
| --- | --- | --- | --- |
| STF-01 | Invite staff by phone/email with role (owner, admin, teacher, cashier, gatekeeper) | Settings → Staff and roles | R1 |
| STF-02 | Teacher scope: restrict to assigned classes | Settings → Staff | R1 |
| STF-03 | Plan limits enforced (Tutor: 1 teacher, 0 cashiers; Institute: unlimited teachers, 3 cashiers) from `PLAN_LIMITS` | Settings → Subscription | R1 |
| STF-04 | Ownership transfer (requires current owner 2-step + Recca confirmation) | — | R2 |

---

## STU — Students

| ID | Feature | Screen | Needs | Rel |
| --- | --- | --- | --- | --- |
| STU-01 | Students table: search name/number/phone; filters class, fee status, devices, joined; pagination; sticky header | Admin Students 12a | N-OWN-1 | R1 |
| STU-02 | Bulk actions: Send SMS, Move class, Mark paid, Sign out devices | 12a | N-OWN-6 | R1 |
| STU-03 | Add student (name, phone, school, A/L year, medium, classes, guardian) → auto student number | 12a | N-OWN-2 | R1 |
| STU-04 | **CSV/Excel import** with column mapping, validation preview, duplicate phone detection, dry run, error file | 12a "Import CSV" | N-OWN-2 | R1 |
| STU-05 | Profile tabs: Overview (owes, paid this year, attendance %, lessons watched, recent activity) · Classes · Payments · Attendance · Devices · Parent | 12b/12c/12f | N-OWN-1 | R1 |
| STU-06 | Student cards. **Permanent** cards printed by ReMix (barcode always; QR and NFC optional on the same card), ordered → active on hand-over; **temporary** barcode cards printed by the institute. Card code = student number + card sequence (`NIL-26-0042-1`), so a lost card is revoked alone; NFC chips carry the code or are linked by UID. Scan at the cash counter (USB/keyboard-wedge reader, camera, Web NFC); typed student number also works | Student profile, 11c | N-GTE-1, N-CSH-2 | R1 (Phase 3, track 3-C2) |
| STU-07 | Student number `<PREFIX>-<YY>-<seq>` (e.g. `NIL-26-0042`): institute prefix of 2–4 English capitals from its name, unique across ReMix; joining year (Asia/Colombo); sequence restarts each year, at least 4 digits and grows as needed; imported students keep their own numbers | Student profile | N-CSH-2 | R1 (Phase 3, track 3-C2) |
| STU-07 | Archive / reactivate student (archived = not active, keeps history) | — | N-OWN-2 | R1 |
| STU-08 | Student self-registration from public site "Enrol" (see WEB-05) | Public Site | N-VIS-1 | R2 |

**Rules:** student number = tenant prefix + zero-padded sequence (`BR-1042`), unique per tenant, never reused. Phone stored E.164 (`+947XXXXXXXX`) via `sriLankaMobile` schema.

---

## CLS — Classes & enrolment

| ID | Feature | Screen | Rel |
| --- | --- | --- | --- |
| CLS-01 | Classes list with filters (A/L year, O/L, online only), students, fee, paid % this month | Admin Classes 8a/8d | R1 |
| CLS-02 | Create/edit class: name, grade/A/L year, medium, teacher, monthly fee, day & time, start date, place (Hall / Online / Hall + Zoom), hall | 8b | R1 |
| CLS-03 | Class detail tabs: Students · Schedule · Lessons · Fees · Attendance; KPIs enrolled/paid/unpaid/avg attendance | 8c/8e | R1 |
| CLS-04 | Enrol / move / remove student; enrolment start month; fee override per enrolment (discount, free card) with reason | 8c | R1 |
| CLS-05 | Halls (name, capacity) as tenant settings | 8b | R1 |
| CLS-06 | Timetable view (week) feeding dashboard "Today's classes" and public site timetable | Dashboard, Public | R1 |
| CLS-07 | Extra/one-off sessions and cancellations (e.g. "Thu 2027 Theory · extra") | Public timetable | R1s |

---

## FEE — Fees & payments

| ID | Feature | Screen | Needs | Rel |
| --- | --- | --- | --- | --- |
| FEE-01 | **Monthly invoices** per active enrolment, generated on the 1st (Asia/Colombo) or at enrolment; number `KP-I-YY-MM-<studentNo>` | Admin Fees 11d | N-CSH-3 | R1 |
| FEE-02 | Invoices tab: filters All/Paid/Unpaid/Overdue/Slip waiting; "Send reminder SMS to N unpaid"; export | 11d | N-OWN-6 | R1 |
| FEE-03 | Student Pay: unpaid months with checkboxes, total, choose card or slip | Student Pay 6a/6b/6g | N-STU-2 | R1 |
| FEE-04 | **PayHere checkout** with the institute's own merchant; server-verified notify; instant unlock; receipt | 6b/6d | N-STU-2 | R1 |
| FEE-05 | **Bank slip upload**: institute bank details shown, photo upload (≤ 5 MB, JPEG/PNG/HEIC→JPEG), reference number, amount; status "Checking" | 6c/6e | N-STU-2 | R1 |
| FEE-06 | **Slip queue**: oldest first; image viewer (zoom/rotate); expected vs read amount; reference duplicate check; Approve **A** / Reject **R** with reason (SMS to student) / Skip **S**; auto-advance | Admin Fees 11a/11b/11e | N-CSH-1 | R1 |
| FEE-07 | **Cash counter**: scan card or search → pick months → total → cash received → change → print 80 mm receipt + SMS receipt | 11c/11f | N-CSH-2 | R1 |
| FEE-08 | Record payment manually (bank transfer seen in statement, cheque) with note | Dashboard "Record payment" | N-CSH-3 | R1 |
| FEE-09 | Receipts: number `KP-R-YY-NNNNN`, PDF download, reprint, template settings (logo, address, footer) | 6d, Settings → Receipts | N-STU-2 | R1 |
| FEE-10 | Payment history for student (date, for, method, amount, status, receipt) | 6f/6g | N-STU-2 | R1 |
| FEE-11 | Reverse a payment (owner only, reason, re-locks month if unpaid, audit) | — | N-OWN-7 | R1 |
| FEE-12 | Fee reminders: due date (default 5th), automatic SMS on due date − 2 days and overdue +3 days (configurable, opt-out per tenant) | 6g "due by 5 Oct" | N-PAR-2 | R1 |
| FEE-13 | OCR assist reads amount/reference from slip image (worker) | 11a "Read from slip" | N-CSH-1 | R1s |
| FEE-14 | Daily PayHere reconciliation job: compare notifications with PayHere API; alert on mismatch | — | N-CSH-3 | R2 |

### Business rules — the money core (must have unit + integration tests)

1. **Ledger first.** Every payment (card, slip, cash, manual) creates a `payment` and one or more `payment_allocations` to invoice lines. "Paid" is derived: `sum(allocations) ≥ line amount`. Nobody edits a status by hand.
2. **Unlock rule.** A student can watch a month's lessons and join that month's live sessions for a class when the invoice line for *(enrolment, month)* is paid. Card → immediately on verified notify. Slip → on approval. Cash/manual → on recording. Free/waived lines count as paid.
3. **Slip lifecycle:** `submitted → approved | rejected | superseded`. A rejected slip sends an SMS with the reason; the student can submit again. An approved slip creates a payment for the *expected* amount of the selected lines; if the slip amount differs, the cashier must choose: approve selected lines only, or reject.
4. **Duplicate reference:** same bank reference + amount already approved in this tenant → flagged "Reference used before" and approve requires confirmation.
5. **PayHere:** the browser redirect is never trusted. Only the `notify_url` POST with a valid `md5sig` (merchant secret), matching order id, amount and currency `LKR` marks a payment. Processing is idempotent on PayHere `payment_id`.
6. **Money** is integer cents; display `LKR 2,500.00` in the app.
7. **Invoices** for a month are generated once per enrolment; mid-month enrolment generates the current month (pro-rata off by default, setting R2).
8. **Reversal** never deletes: creates a negative payment + audit entry; month re-locks if no longer paid.
9. **Receipt numbers** are sequential per tenant without gaps (allocated in the same DB transaction).

---

## LES — Lessons & video

| ID | Feature | Screen | Needs | Rel |
| --- | --- | --- | --- | --- |
| LES-01 | Lessons list by class/month; source badge (Protected video / YouTube / PDF); views; status Processing/Ready/Scheduled; release | Admin Lessons 9a/9d | N-TCH-1 | R1 |
| LES-02 | **Upload video**: resumable (TUS) direct to Bunny with short-lived signed credentials; progress; can close panel; processing 10–20 min; webhook marks Ready | 9b/9e | N-TCH-1 | R1 |
| LES-03 | YouTube link lesson with warning "not protected — use for free previews"; who can watch = Everyone (free) | 9c | N-TCH-1 | R1 |
| LES-04 | Tute PDF attach (≤ 50 MB, magic-byte checked) stored in private R2; signed URL ≤ 10 min | 9b | N-TCH-1 | R1 |
| LES-05 | Release scheduling (date/time) and access rule ("Paid students · Oct" / "Everyone (free)") | 9b/9c | N-OWN-3 | R1 |
| LES-06 | **Player**: Bunny token-auth HLS; 360/480/720p; speed; resume position; moving watermark `BR-1042 · 077 xxx 4521`; download disabled; teacher notes; tute; "Mark as done"; month lesson list | Lesson Player 4a/4b | N-STU-3, N-OWN-3 | R1 |
| LES-07 | YouTube free-preview player with "Join this class" CTA | 4c | N-VIS-1 | R1 |
| LES-08 | Class page (student): month tabs, video lessons with watched progress, tutes, live sessions; locked month with "Pay LKR X to unlock" | Student Classes 3b/3c/3d | N-STU-2/3 | R1 |
| LES-09 | Watch progress + "continue watching" + view counts | Student Home, 9a | N-STU-3 | R1 |
| LES-10 | Per-download PDF watermark (student name + number) in a worker | — | N-OWN-3 | R1s |
| LES-11 | Usage: video GB delivered this month vs allowance; storage | Integrations "Video" | N-PST-3 | R1 |
| LES-12 | Bring your own Bunny account (Enterprise) | Integrations | — | R2 |

**Rules:** playback tokens expire ≤ 2 h, bound to video id + tenant; Bunny referrer restricted to the tenant's hosts; MediaCage Basic on. Video tokens are only issued after the unlock rule passes.

---

## LIV — Live classes (Zoom)

| ID | Feature | Screen | Needs | Rel |
| --- | --- | --- | --- | --- |
| LIV-01 | Zoom not connected: explainer (paid Zoom plan needed for name lock) + "Connect with Zoom" (OAuth) | Admin Live 10a | N-OWN-4 | R1 |
| LIV-02 | Sessions list This week / Next week / Past with invited, status (Live · N in / Starts in / Scheduled / Ended · N attended) | 10b/10e | N-OWN-4 | R1 |
| LIV-03 | Schedule: class, date, start, duration, repeat weekly, auto-register paid students (new payments added until start), lock names to "Name · BR-number", save recording to this month's lessons | 10c/10f | N-OWN-4 | R1 |
| LIV-04 | Student Live tab: today/upcoming/past with states not paid / not started (join opens 10 min before) / live now / ended (watch recording) / in hall only | Student Live 5a/5c | N-STU-1 | R1 |
| LIV-05 | Join: confirm sheet "You'll join as Nimali Perera · BR-1042"; open Zoom app or browser; personal registrant join URL | 5b | N-STU-1 | R1 |
| LIV-06 | Attendance import from Zoom (webhooks + report API): joined time, time in class, Present/Late/Left early/Absent; CSV download | Session detail 10d | N-TCH-2 | R1 |
| LIV-07 | Absent → SMS to parents (setting) | 10d "SMS sent to parents" | N-PAR-1 | R1 |
| LIV-08 | Recording → copied to Bunny and attached to the month's lessons | 10c option | N-STU-3 | R1s |
| LIV-09 | Disconnect Zoom (revoke tokens), token refresh server-side, deauthorization webhook | Integrations | N-OWN-7 | R1 |

**Rules:** Zoom tokens encrypted at rest (AES-256-GCM). Registrants are created only for students whose month is paid; join URLs are per registrant (unique) and never shown to unpaid students. Late = joined > 10 min after start (setting); Left early = time in class < 75% of scheduled duration.

---

## ATT — Attendance

| ID | Feature | Screen | Rel |
| --- | --- | --- | --- |
| ATT-01 | Attendance record model with source (zoom / gate / manual / qr) and status; one per student per session | — | R1 |
| ATT-02 | Manual marking for hall classes (teacher/admin, tablet-friendly list) | Class detail → Attendance | R1 |
| ATT-03 | Dashboard "Present today N of M" (gate + Zoom) and absent list | Dashboard | R1 |
| ATT-04 | QR scan at hall via web scanner (staff phone camera) — online | — | R1s |
| ATT-05 | Attendance reports per class / student / month | Reports | R2 |
| ATT-06 | ReMix+ offline gate app (see GTE) | — | R3 |

---

## MSG — Messages & notifications

| ID | Feature | Screen | Rel |
| --- | --- | --- | --- |
| MSG-01 | `SmsProvider` interface; Notify.lk and Text.lk adapters (platform picks primary + optional fallback by config); delivery status where the gateway supports it | — | R1 |
| MSG-02 | ReMix SMS wallet: balance, sender ID (registered), ledger, low-balance alert, staff "Buy SMS" (invoice to institute) | Integrations 13a | R1 |
| MSG-03 | Compose SMS to: class, unpaid students, parents of absentees, selected students; segment count + cost preview; Sinhala/Tamil unicode counting | Messages | R1 |
| MSG-04 | System SMS: OTP, receipts, slip approved/rejected, fee reminders, absence, class changes — templates per locale | — | R1 |
| MSG-05 | Own gateway (Text.lk or generic HTTP API) with test SMS; **SSRF-guarded** (https only, public IPs, no redirects, 5 s timeout) | 13b | R2 |
| MSG-06 | Announcements ("From Kamal sir") to class / all; shown on student home and public site | Student Home, Public | R1s |
| MSG-07 | Email (Resend) for staff: invites, impersonation notice, platform invoices | — | R1 |

**Rules:** OTP SMS always sent from the ReMix wallet (never BYO) and rate-limited to block SMS-pumping fraud. Messages are queued (BullMQ), never sent in the request.

---

## WEB — Institute public website

| ID | Feature | Screen | Rel |
| --- | --- | --- | --- |
| WEB-01 | Template site from tenant data: hero, about the teacher, classes, weekly timetable, results (images), announcements, contact (address, phone, hours, WhatsApp, map), "Powered by ReMix" | Institute Public Site 7a/7b | R1 |
| WEB-02 | Website settings: hero text, teacher bio/photo, contact, social, sections on/off | — | R1 |
| WEB-03 | Page builder (Puck) with blocks: Hero, Teacher profile, Class list, Timetable, Results, Gallery, Announcements, Contact; draft/publish; preview desktop/mobile | Brief B8 | R2 |
| WEB-04 | SEO per tenant: title/description, OG image, sitemap, robots; JSON-LD `EducationalOrganization` | — | R1 |
| WEB-05 | Online enrolment: pick class → register (phone verify by SMS) → pay first month → account created | "Enrol", "New student? Join a class" | R2 |

**Rules:** blocks store **data only**, never raw HTML/JS; rich text sanitised server-side. Public pages are cached at the edge per tenant host (cache key includes host).

---

## RPT — Reports

| ID | Feature | Rel |
| --- | --- | --- |
| RPT-01 | Income by class/month/method; expected vs collected; CSV | R1s |
| RPT-02 | Unpaid list per month with phone numbers (export, SMS action) | R1 |
| RPT-03 | Attendance trends per class; lessons watched | R2 |
| RPT-04 | PDF export of monthly summary | R2 |

---

## SET — Settings & integrations

| ID | Feature | Screen | Rel |
| --- | --- | --- | --- |
| SET-01 | Settings tabs: General · Staff and roles · Integrations · Subscription · Domain · Receipts | Admin Integrations 13a | R1 |
| SET-02 | PayHere: merchant ID + secret (masked after save), Sandbox/Live, "Test payment (LKR 10)", last test status | 13a/13d | R1 |
| SET-03 | Bank details for slips (bank, branch, account, name) | Student Pay 6c | R1 |
| SET-04 | Zoom connection card (account, plan, scopes, connected date, Disconnect) | 13a | R1 |
| SET-05 | SMS card (wallet balance / own gateway) | 13a/13b | R1 |
| SET-06 | Video usage card; own Bunny (Enterprise, upgrade prompt) | 13a | R1 |
| SET-07 | Subscription: plan, active students this cycle vs plan, invoices, upgrade/downgrade request | More menu 17b | R1 |
| SET-08 | Notification settings (reminder days, absence SMS on/off, late threshold) | — | R1 |

**Rules:** all secrets encrypted at rest (AES-256-GCM, key from env/secret store, key id stored for rotation); only last 4 chars ever returned to the browser.

---

## PLT — Platform admin

| ID | Feature | Screen | Rel |
| --- | --- | --- | --- |
| PLT-01 | Overview: MRR (+% vs last month), active institutes (paid/trial), active students this cycle, trials ending 7 days, video TB, system health (API, video, SMS, PayHere) | Platform 14a/14d | R1 (KPIs) |
| PLT-02 | Institutes table: search, plan, status (Active / Trial · N days / Payment failed / Suspended), students, MRR, domain; export; add institute | 14a | R1 |
| PLT-03 | Institute detail tabs: Overview · Usage · Domains · Features · Billing · Audit log; actions Change plan, Suspend, Log in as admin | 14b/14e | R1 |
| PLT-04 | **Log in as admin**: reason required, recorded in tenant audit log, owner emailed, banner visible, ends after **30 min** | 14c | R1 |
| PLT-05 | Support inbox (tickets count), notes per institute | 14a "Support 6" | R2 |
| PLT-06 | Staff & roles for Recca Labs (super admin, support, finance, sales) with 2FA status | 14a "Staff" | R1 |
| PLT-07 | Platform audit log (all staff actions) | 14a "Audit log" | R1 |
| PLT-08 | Lead inbox from remix.lk D1 → convert to tenant | — | R2 |
| PLT-09 | Announcements banner to all/selected institutes | Brief | R2 |

**Decision:** impersonation is 30 minutes (design) — DEVELOPMENT.md's 60 minutes is superseded; see ADR backlog.

---

## BIL — ReMix billing

| ID | Feature | Rel |
| --- | --- | --- |
| BIL-01 | Active-student metering: student is active in a cycle if they had a payment allocation **or** a successful login during the tenant's 30-day cycle; daily snapshot + end-of-cycle count | R1 |
| BIL-02 | Platform invoice per cycle: base + per-student × active, add-ons, SMS top-ups; uses `monthlyPrice` from `@remix/types` (no duplicated numbers) | R1 |
| BIL-03 | Collection: pilots by bank transfer recorded by finance staff; R2 PayHere recurring/card for ReMix itself | R1 manual / R2 |
| BIL-04 | Dunning: due → reminder email/SMS → +7 days "Payment failed" → +14 days suspend (configurable); reactivation on payment | R1 |
| BIL-05 | Trial: 30 days, full features, no card; trial-ending emails at −7/−3/−1 days | R1 |
| BIL-06 | Plan change with proration rules (upgrade immediate, downgrade at cycle end) | R2 |

---

## PAR — Parents

| ID | Feature | Rel |
| --- | --- | --- |
| PAR-01 | Guardian record (name, relation, phone) linked to students; SMS preferences | R1 |
| PAR-02 | Parent view (login by phone + SMS code): child switcher, attendance, fees, pay | R2 |
| PAR-03 | Parental consent capture for students under 18 (PDPA) at registration/import | R1 |

---

## DAT — Data import, export, lifecycle

| ID | Feature | Rel |
| --- | --- | --- |
| DAT-01 | Import wizard (students, classes, enrolments, opening balances) — used by Recca staff for free migration | R1 |
| DAT-02 | Tenant data export (CSV bundle) on request and on exit | R1 |
| DAT-03 | Retention: deleted tenant data purged 30 days after export window; slips/receipts kept per legal retention (7 years for financial records — confirm with lawyer) | R1 |
| DAT-04 | Data-subject requests (access/correction/deletion) workflow for institutes | R2 |

---

## GTE — ReMix+ gate app (R3)

Offline-first Expo app: class selection with "Offline ready ✓ synced 7:02 AM", QR/NFC scan, full-screen GREEN/RED/AMBER results readable from 1 m, counter "164 / 180 in", offline queue "23 scans waiting to sync", manual override with 4-digit receipt code. Signed, expiring fee snapshot synced each morning; scans uploaded idempotently. Device enrolment per hall. Priced as an add-on (`ADDONS.gate`).

---

## Cross-cutting UX requirements (apply to every feature)

- Every list has **empty, loading (skeleton) and error** states (DESIGN.md §5).
- Every destructive action has a confirm; deleting a class/institute requires typing its name.
- Every status shows a word + colour (never colour alone).
- Every money amount uses `formatLKR`, tabular figures, right-aligned in tables.
- Every date: `Sat, 26 Sep 2026 · 8:00 AM` Asia/Colombo; fee months `Oct 2026`.
- Admin screens have a mobile layout (designs 8d/8e, 9d, 10e, 11e/11f, 12e/12f, 13c/13d, 17a/17b).
- Student screens work at 360 px, ≥ 44 px touch targets, < 200 KB JS per route.
