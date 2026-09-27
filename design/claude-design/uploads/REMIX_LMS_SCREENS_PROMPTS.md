# ReMix — Site Map & Missing LMS Screens (Claude Design prompts)

> Your current Claude Design project covers **the ReMix company website** (remix.lk) plus one Institute Dashboard.
> The actual LMS lives on **each institute's own site**. Paste the prompts below into the SAME Claude Design project so
> they reuse your existing `ReMix Brand`, `Site Header` and `Site Footer` styles.

---

## 1. The three websites ReMix runs

```
1. remix.lk                      → OUR company website (sells ReMix)          ✅ designed
   Home · Pricing · For Institutes · For Teachers · Guides · About

2. admin.remix.lk                → OUR staff control panel (all institutes)   ❌ not designed

3. <institute>.remix.lk          → EACH institute's LMS (one per customer)    ❌ mostly not designed
   e.g. kamalphysics.remix.lk
   ├── Public pages   /  /classes  /timetable  /contact        (anyone)
   ├── Student area   /login  /home  /classes/...  /pay  ...   (students, parents)
   └── Admin area     /admin/...                                (owner, teachers, cashier)
                      └── Dashboard ✅ designed, rest ❌
```

Students never use remix.lk. They go to their institute's site. That is where the student dashboard,
payments, classes, video lessons and live classes live.

## 2. How a student uses it (the journey)

```
Institute site (kamalphysics.remix.lk)
  → Login (phone + password)
  → Student Home: live class now, fees due, new lessons
      ├─ My Classes → Class page → month → Lesson list
      │                  ├─ Video lesson player (Bunny protected or YouTube)
      │                  └─ Tutes / PDFs
      ├─ Live → today's Zoom classes → "Join" (name locked)
      ├─ Pay → unpaid months → PayHere card OR upload bank slip → receipt
      └─ Me → profile, devices, language, parent link
```

A month's lessons and live classes unlock only after that month's fee is paid (card = instant, bank slip = after
cashier approval).

## 3. How the institute runs it (admin journey)

```
/admin
  Dashboard ✅
  Students → add/import → profile
  Classes → create class, fee, schedule
  Lessons → upload video (Bunny) or paste YouTube link → attach to class + month
  Live classes → Zoom connected? → schedule session → students get join links
  Fees & payments → invoices · bank-slip queue · cash counter · receipts
  Attendance · Messages (SMS) · Reports
  Website → theme + page builder + domain
  Settings → Integrations (Zoom, PayHere, SMS gateway, Bunny) · staff & roles · subscription
```

---

## 4. Screens still to design (priority order)

| # | Screen | Area | Size |
| --- | --- | --- | --- |
| 1 | Student login + device limit | Student | Mobile 390 |
| 2 | Student home | Student | Mobile 390 + desktop 1440 |
| 3 | My classes + class page (months, lessons, tutes) | Student | Mobile + desktop |
| 4 | Video lesson player | Student | Mobile + desktop |
| 5 | Live classes + join | Student | Mobile |
| 6 | Pay fees + bank slip upload + receipts | Student | Mobile |
| 7 | Institute public home page | Public | Desktop + mobile |
| 8 | Admin: Classes + class detail | Admin | Desktop |
| 9 | Admin: Lessons upload | Admin | Desktop |
| 10 | Admin: Live classes (Zoom) | Admin | Desktop |
| 11 | Admin: Fees & bank-slip queue | Admin | Desktop |
| 12 | Admin: Students + profile | Admin | Desktop |
| 13 | Admin: Settings → Integrations | Admin | Desktop |
| 14 | Platform admin: overview + institute detail | Our staff | Desktop |

---

## 5. Prompts (paste one at a time in the same project)

### Context prompt (paste first)

```
Next we design the LMS that runs on EACH institute's own site (e.g. kamalphysics.remix.lk), not the ReMix company site.
Reuse the ReMix Brand tokens, type and components from this project. On institute sites the brand colour is the
institute's own (make it a tweak, default #2B4BF2); the ReMix header/footer is NOT used there — the institute's
logo and name are shown instead, with a small "Powered by ReMix" in the footer.
Sample institute: "Kamal Physics" (A/L Physics, Sinhala & English medium). Sample student: Nimali Perera, BR-1042.
Use realistic sample data, LKR amounts, Asia/Colombo times. Mobile frames 390×844, desktop 1440.
```

### P1 — Student login + device limit (mobile)

```
Design 3 mobile screens for the institute's student login:
1. Login: institute logo and name, phone field with +94 prefix, password, "Stay signed in for 30 days", "Forgot password? Get an SMS code".
2. SMS code screen with 6 boxes and resend timer.
3. "You're signed in on 2 devices" screen listing both devices with "Sign out this device and continue", and a short note that the 2-device rule protects the teacher's lessons.
```

### P2 — Student home (mobile + desktop)

```
Design the Student Home for Nimali at Kamal Physics. Mobile: institute-colour header "Hi Nimali", bottom tab bar
Home · Classes · Pay · Live · Me. Desktop: left sidebar with the same items.
Content: "LIVE NOW · 2027 A/L Physics Theory · Join class" card; fee banner "October 2026 fee due · LKR 2,500 · Pay now";
"Continue watching" (Lesson 14 · Waves, 18 of 52 min); "New this week" lessons; "Today" schedule (8:00 AM Hall A, 7:00 PM Zoom);
announcements from the teacher.
```

### P3 — My classes + class page

```
Design "My classes" (cards: class name, teacher, day/time, medium, this month paid/unpaid badge) and a Class page:
header with class name and teacher, month tabs (Aug, Sep, Oct 2026), and for each month: video lessons list
(title, duration, watched progress), tutes/PDFs with download, and upcoming live sessions.
An unpaid month shows its lessons locked with a lock icon and a "Pay LKR 2,500 to unlock October" button.
Mobile and desktop.
```

### P4 — Video lesson player

```
Design the lesson player page. Desktop: large video on the left with a faint moving watermark "BR-1042 · 077 xxx 4521",
speed and quality (360p / 480p / 720p) controls; right column: lesson list for the month with the current one highlighted.
Below the video: title, date, teacher notes, attached tute, "Mark as done". Small note: "Downloading is disabled to
protect your teacher's work." Add a variant for a YouTube-mode lesson with the note "This lesson is a free preview."
Mobile version with the list under the video.
```

### P5 — Live classes (mobile)

```
Design the Live tab: today's and upcoming live classes (class, time, "Starts in 25 min" / "Live now"), a big
"Join class" button for the live one (opens Zoom with the student's name locked), and past recordings if the
teacher uploaded them. States: not paid ("Pay October fee to join"), not started yet, live now, ended.
```

### P6 — Pay fees (mobile)

```
Design the Pay flow: 1) Unpaid months list with checkboxes per class (e.g. A/L Physics Theory Oct 2026 LKR 2,500,
Revision Oct 2026 LKR 1,500) and total; 2) choose "Pay by card (PayHere)" or "Upload bank slip" (bank details of the
institute, photo upload, reference number); 3) success screens: card = "Paid, October unlocked" with receipt;
bank slip = "Slip sent, the office will confirm soon". Plus Payment history with receipt downloads.
```

### P7 — Institute public home page

```
Design Kamal Physics' public home page (what parents and new students see at kamalphysics.remix.lk):
hero with teacher photo placeholder and "Join a class"/"Student login"; about the teacher; class cards
(grade, medium, day/time, hall/online, monthly fee, Enrol); weekly timetable; results highlights (placeholder);
announcements; contact with WhatsApp and map placeholder; footer "Powered by ReMix". Desktop + mobile.
```

### P8 — Admin: Classes + class detail

```
Design the institute admin Classes screen (same shell as Institute Dashboard): class cards/table with students
count, fee, schedule, teacher, paid % this month; "Create class" dialog (name, grade, medium, teacher, fee, schedule,
hall/online). Class detail with tabs Students · Schedule · Lessons · Fees · Attendance.
```

### P9 — Admin: Lessons upload

```
Design Lessons management: list of lessons by class and month with source badge (Protected video / YouTube / PDF),
views, status (Processing / Ready). "Add lesson" panel: choose class + month, then either upload a video
(drag-and-drop with progress and "Processing…" state) or paste a YouTube link (with a warning that YouTube videos
are not protected), add title, notes and tute PDF, schedule release date.
```

### P10 — Admin: Live classes (Zoom)

```
Design Live classes: if Zoom is not connected, show a card "Connect your Zoom account" with explanation that a paid
Zoom plan is needed for name lock. When connected: calendar/list of sessions, "Schedule live class" dialog (class,
date/time, duration, auto-register paid students), session detail with join count and attendance pulled from Zoom.
```

### P11 — Admin: Fees & bank-slip queue

```
Design Fees & payments with tabs Invoices · Payments · Bank slips · Cash counter.
Bank slips: left list of pending slips, centre slip image viewer, right student details with expected vs detected amount,
buttons Approve (A) / Reject (R) with reason / Skip (S). Cash counter: search student → pick months → amount → Print receipt.
```

### P12 — Admin: Students + profile

```
Design Students: table (name, student no., phone, classes, October fee status, last seen, devices 1/2),
filters, "Import CSV", "Add student", bulk actions. Student profile with tabs Overview · Classes · Payments ·
Attendance · Devices (with Sign out buttons) · Parent.
```

### P13 — Admin: Settings → Integrations

```
Design Settings → Integrations with cards and connection status:
- Zoom: Connect with Zoom (OAuth), connected account email, "Disconnect".
- Payments (PayHere): merchant ID and secret fields, sandbox/live toggle, "Test payment".
- SMS: choose "ReMix SMS wallet" (balance 4,200 SMS, "Buy SMS") or "Use my own gateway" (provider select:
  Text.lk / Other HTTP API, API key, sender ID, "Send test SMS").
- Video: "ReMix protected video" usage this month (GB used of included), or Enterprise "Connect your own Bunny account".
Keys are shown masked after saving.
```

### P14 — Platform admin (our staff)

```
Design admin.remix.lk for Recca Labs staff, using the ReMix brand with a dark sidebar:
Overview (MRR, active institutes, active students, trials ending, video TB, system health) and an Institutes table
with plan, status, students, MRR, domain; plus an Institute detail page with "Log in as admin" (recorded),
Change plan, Suspend, usage, domains, features and audit log.
```
