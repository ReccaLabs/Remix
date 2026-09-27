# ReMix — Claude Design Brief

> How to use: start a new design in Claude Design, paste **Part A (Global context)** first, then paste one screen prompt from **Part B** at a time. Ask for changes on each screen before moving to the next. Keep every screen on the same canvas so the style stays consistent.

---

# PART A — Global context (paste this first)

```
You are designing the UI for ReMix, a multi-tenant SaaS for Sri Lankan tuition teachers and institutes, made by Recca Labs.
ReMix gives each institute: its own website, student and fee management, PayHere card payments and bank-slip approval,
protected video lessons (encrypted streaming + moving student-ID watermark), Zoom classes with name lock,
QR/NFC attendance and parent alerts. Pricing is per active student (a student counts once, however many classes they join).

There are four areas, all sharing one design system:
1. Marketing website (remix.lk) — audience: teachers and institute owners. Mood: confident, warm, local, trustworthy.
2. Platform admin (admin.remix.lk) — Recca Labs staff manage ALL institutes. Mood: dense, precise, dark sidebar.
3. Institute admin (<institute-domain>/admin) — owner, teacher, cashier. Mood: quiet, fast, data-dense, light.
4. Student portal (<institute-domain>) — mobile-first for low-end Android phones. Mood: friendly, simple, big tap targets.

DESIGN SYSTEM
Colours:
- Brand blue #2B4BF2 (actions, links, active nav) · brand soft #EEF1FF (selected rows, soft badges)
- Accent amber #F2A516 (highlights, "New" badges, marketing only, use sparingly)
- Ink #0E1525 (text) · Muted #5B6478 · Line #E4E7EE · Surface #FFFFFF · Canvas #F6F7FA · Warm marketing background #FBFAF7
- Success #12A150 (Paid, Present) · Warning #D98A00 (Pending slip, Trial ending) · Danger #D92D20 (Unpaid, Suspended) · Info #0B84D9
- Platform admin sidebar #0E1525 with #B5BCCB text.
- Institutes can replace ONLY the brand colour with their own; everything else stays.
Typography:
- Display (marketing headlines): Bricolage Grotesque, 700–800, tight tracking.
- UI and body: Geist. 14px in admin tables, 16px in portal and marketing body.
- Numbers and money: tabular figures, right-aligned in tables. Format money as "LKR 2,500.00".
- Sinhala: Noto Sans Sinhala. Tamil: Noto Sans Tamil. Leave room for longer Sinhala/Tamil words.
Shape and spacing:
- 4px spacing base. Radius 6 (inputs, badges), 10 (buttons, cards), 16 (marketing cards, modals).
- Admin areas use borders, almost no shadows. Marketing cards may use a soft shadow.
- Icons: Lucide-style 1.5–2px stroke line icons. No emoji.
Rules:
- Status is never shown by colour alone: always a word and/or icon (Paid ✓, Unpaid, Pending).
- Touch targets at least 44px on mobile. Text contrast at least 4.5:1.
- No lorem ipsum, no fake testimonials, no invented customer logos. Use realistic sample data with Sri Lankan names,
  subjects (A/L Physics, O/L Maths, Grade 5 Scholarship), halls and LKR amounts, clearly as sample data.
- Dates like "Sat, 26 Sep 2026 · 8:00 AM" (Asia/Colombo). Fee months like "Oct 2026".
- Avoid generic AI-style gradients and glowing blobs. Clean, editorial, confident.
Desktop frames 1440px wide. Mobile frames 390 × 844.
Inspiration (borrow ideas, do not copy): Stripe Dashboard (money tables, calm status badges), Linear (dense lists,
command palette), Vercel (domain setup flow), Shopify admin (merchant home, theme editor), Kajabi/Teachable
(creator site templates), shadcn/ui (component style).
Acknowledge and wait for the first screen prompt.
```

---

# PART B — Screen prompts (paste one at a time)

## B1. Marketing — Home page (desktop 1440)

```
Design the ReMix marketing home page, desktop 1440px wide, warm background #FBFAF7.
Sections top to bottom:
1. Top nav: "ReMix" wordmark (the "x" in amber), links Features · Pricing · For teachers · For institutes · Guides,
   a small language pill "EN · සිං · த", link "Find your class", primary button "Start free".
2. Hero, two columns. Left: small pill "New · Offline gate attendance with NFC cards"; headline
   "Run your whole class, online and in the hall."; subtext "Your own website, fees and bank slips, protected video
   lessons, Zoom with name lock and attendance, built for Sri Lankan tuition. One student counts once, however many
   classes they join."; buttons "Start free trial" (primary) and "Book a demo" (outline); small line
   "From LKR 45 per active student · Free data migration · Sinhala, Tamil, English".
   Right: a laptop-style card showing the institute admin dashboard, overlapped by a phone showing the student portal
   with a "LIVE NOW · 2027 A/L Physics · Join class" card and "October fee due · LKR 2,500".
3. Dark band (#0E1525): heading "The three leaks every tuition class knows." and 3 cards:
   "Lessons leaked to Telegram" / "One account, ten students" / "Chasing fees and bank slips", each with one-sentence fix.
4. Features grid 3×2: Your own website · Fees and bank slips · Protected video · Zoom with name lock ·
   Offline gate attendance · Parents in the loop. Icon tile, title, one or two sentences each.
5. Pricing calculator block on #EEF1FF: heading "Pay per student, not per class card."; student count pills
   100 / 300 / 1,000 / 2,500 (300 selected); result card: plan badge "Institute", "ReMix per month LKR 23,400",
   "Per-class-card pricing LKR 67,500" struck through, green row "You save each month LKR 44,100",
   button "Start free for 30 days". Note: "Assumes 1.5 classes per student and LKR 150 per class card."
   Make the pills interactive if possible (Tutor: 3,000 + 50/student up to 150; Institute: 9,900 + 45/student up to 1,500;
   Enterprise: 25,000 + 35/student).
6. Screens tour with tabs "Admin · Student · Parent" (show one screenshot area).
7. FAQ with 5 questions: Is our student data safe? Can you move our students from another system? Which payment
   methods work? Does it work in Sinhala and Tamil? What happens if the internet goes down at the hall?
8. Final CTA: "Move your class to ReMix this month. We move your students for you." buttons "Start free trial",
   "Chat on WhatsApp".
9. Dark footer: ReMix by Recca Labs · Colombo; columns Product, Company, Legal.
```

## B2. Marketing — Pricing page (desktop 1440)

```
Design the ReMix pricing page, same style as the home page.
- Heading "Simple pricing. One student counts once." Toggle Monthly / Yearly (Yearly: "2 months free").
- Three plan cards:
  Tutor — LKR 3,000/month + LKR 50 per active student — "1 teacher, up to 150 students" — features: classes & fees,
    PayHere + bank slips, Zoom name lock, protected video, 200 GB storage, free subdomain.
  Institute (highlighted "Most popular") — LKR 9,900/month + LKR 45 per active student — "Many teachers, up to ~1,500
    students" — everything in Tutor + unlimited teachers, 3 cashier logins, QR attendance, exams, own domain, 1 TB.
  Enterprise — LKR 25,000/month + LKR 35 per active student — "Branches and 1,500+ students" — everything + white-label
    mobile app, branch reports, priority support, 3 TB.
- Add-ons table: ReMix+ offline gate attendance LKR 5,000 per branch/month · Hardware DRM LKR 75 per student in premium
  courses · SMS LKR 0.95 each · White-label app LKR 25,000 one-time · Extra video LKR 3 per GB over 20 GB per student.
- "What counts as an active student?" explainer: paid a fee or logged in during the 30-day cycle; inactive students are free.
- The same calculator as the home page, larger, with a slider for students and a slider for classes per student.
- FAQ and final CTA.
```

## B3. Platform admin — Overview (desktop 1440)

```
Design the Recca Labs platform admin overview at admin.remix.lk, desktop 1440 × 960.
- Dark sidebar (#0E1525, 248px): "ReMix Platform" logo; nav with icons: Overview (active), Institutes, Billing,
  Domains, Usage, Support, Announcements, Staff & security, System. Bottom: staff avatar "Irusha · Super admin".
- Top bar: global search "Search institutes, domains, invoices…  Ctrl K", environment badge "Production", bell.
- KPI cards row: MRR "LKR 846,000" (+12% vs last month) · Active institutes "40" · Active students "9,850" ·
  Trials ending this week "5" · Video delivered this month "58 TB".
- Chart: MRR over the last 12 months (bars) with a line for active institutes.
- Table "Institutes needing attention": name, plan badge, status (Active / Trial / Overdue / Suspended with word + colour),
  active students, MRR, primary domain, action button "Open". 6 sample rows, e.g. Kamal Physics (kamalphysics.remix.lk),
  Apex Tuition (learn.apextuition.lk), Bright Education, NextGen Academy, Sipsala Maths, Vidura Science.
- Right column: "Trials ending" list, "System health" card (API p95 180 ms, queue backlog 0, last backup 02:00 ✓).
Use sample data and label nothing as real customers.
```

## B4. Platform admin — Institute detail (desktop 1440)

```
Design the institute detail page in the platform admin (same shell as B3).
- Header: institute logo + "Kamal Physics", status "Active", plan "Institute", created "12 Jan 2026".
  Actions: "Log in as admin" (primary), "Change plan", "Suspend" (danger, outline).
- Tabs: Overview · Plan & billing · Domains · Usage · Features · Staff · Audit log. Show Overview.
- Overview content: usage cards (active students 468, video this month 2.8 TB, storage 320 GB of 1 TB, SMS balance 4,200);
  domains list (kamalphysics.remix.lk primary ✓, learn.kamalphysics.lk SSL active ✓);
  recent ReMix invoices table (month, amount, status); feature toggles preview (Hardware DRM off, ReMix+ gate on,
  White-label app off).
- Also design the "Log in as admin" confirm dialog: reason field (required), note "This session is recorded and the
  institute will see a banner.", buttons Cancel / Start support session.
```

## B5. Institute admin — Dashboard (desktop 1440)

```
Design the institute admin dashboard for "Kamal Physics" at kamalphysics.remix.lk/admin, desktop 1440 × 1000, light UI.
- Light sidebar (248px): institute logo + name; nav with icons: Dashboard (active), Students, Classes, Fees & payments,
  Lessons, Live classes, Attendance, Website, Messages, Reports, Settings. Footer: "Powered by ReMix".
- Top bar: search "Search students, classes…  Ctrl K", language switch EN/සිං/த, bell, avatar "Kamal Jayasinghe · Owner".
- Header: "Good morning, Kamal" and "Sat, 26 Sep 2026". Quick actions: Add student · Record payment · Upload lesson.
- KPI cards: Fees collected this month "LKR 1,284,500 of 1,560,000" with 82% progress bar · Unpaid students "64" ·
  Bank slips waiting "18" (warning style, button "Review now") · Present today "412 of 468".
- Left (wide): "Today's classes" table — time, class, place (Hall A / Online), expected, present, status
  (e.g. 8:00 AM 2027 A/L Physics Theory, Hall A, 180, 164, In progress; 10:30 AM 2026 A/L Revision, Online, 220, —, Starts in 40 min).
- Right: "Bank slips waiting" preview list (student, class, month, amount, uploaded time) with "Open queue".
- Bottom: "Recent payments" table (student, student no., class, month, method Card/Bank slip/Cash, amount, time).
Include a thin tweak for the institute brand colour so we can show how an institute's own colour looks.
```

## B6. Institute admin — Bank slip queue (desktop 1440)

```
Design the "Bank slip queue" screen (Fees & payments → Bank slips) for a cashier, desktop 1440.
- Left list (360px): 18 pending slips, each row: student name, student no., class, month, amount, uploaded "12 min ago";
  selected row highlighted. Filters: All classes, month.
- Centre: large bank slip image viewer (zoom, rotate buttons), with a sample slip placeholder.
- Right panel: student details (name, phone, classes, current dues for Oct 2026), detected amount vs expected amount
  (match ✓ or mismatch warning), reference number field, notes.
- Big actions at the bottom: "Approve (A)" primary green, "Reject (R)" outline red with reason dropdown,
  "Skip (S)". Show keyboard hints. After approve, the next slip loads automatically.
- Empty state variant: "All slips reviewed. Nice work." with illustration.
```

## B7. Institute admin — Students list and profile (desktop 1440)

```
Design the Students screen.
- Header "Students · 468 active", actions "Import CSV" and "Add student".
- Filters: class, grade, fee status (Paid / Unpaid / Pending), device limit hit; search by name, phone or student no.
- Data table: checkbox, avatar + name, student no. (BR-1042), phone (+94 77…), classes (chips), Oct 2026 fee status,
  last seen, devices (1/2, 2/2), row menu. Bulk actions bar when rows are selected: Send message, Mark paid, Export.
- Second frame: Student profile drawer or page for "Nimali Perera": header with status, tabs Overview · Classes ·
  Payments · Attendance · Devices · Parent. Devices tab shows two devices with "Sign out" buttons.
```

## B8. Institute admin — Website builder (desktop 1440)

```
Design the Website builder (Website → Home page).
- Left panel: blocks library (Hero, Teacher profile, Class list, Timetable, Results, Gallery, Announcements, Contact)
  and "Theme" tab (logo upload, brand colour picker, font choice, light/dark).
- Centre: live preview of the institute home page for "Kamal Physics" with the selected block outlined.
- Right panel: settings for the selected block (e.g. Hero: headline, subtext, photo, button label and link).
- Top bar: page selector (Home, About, Classes, Contact), device toggle (desktop/mobile), "Preview", "Publish" primary,
  and "Draft saved 2 min ago".
- Also a Domain settings frame inspired by Vercel: current subdomain, "Add your own domain" field, then a card showing
  the CNAME record to add (Type CNAME · Name learn · Value domains.remix.lk) with statuses Pending → Verified → SSL active.
```

## B9. Institute public website — template (desktop 1440 + mobile 390)

```
Design a public institute home page template made from the builder blocks, for "Kamal Physics — A/L Physics in Sinhala
and English medium". Sections: hero with teacher photo placeholder and "Join class" button, teacher profile,
class list cards (grade, medium, day/time, hall/online, monthly fee, Enrol button), weekly timetable, results highlight
(placeholder for real results), announcements, contact with map placeholder and WhatsApp button, footer "Powered by ReMix".
Use the institute brand colour (tweakable). Provide desktop and mobile frames.
```

## B10. Student portal — Home, Class, Lesson player, Pay (mobile 390 × 844)

```
Design 4 mobile screens for the student portal of "Kamal Physics", mobile-first, 390 × 844, institute brand colour header.
Bottom tab bar on every screen: Home · Classes · Pay · Live · Me.
1. Home: greeting "Hi Nimali", "LIVE NOW · 2027 A/L Physics Theory · Hall A & Zoom" card with "Join class",
   fee banner "October fee due · LKR 2,500 · Pay now", "New lessons" list, "Today" schedule.
2. Class page: class header, month tabs (Sep, Oct), lessons list with duration and a lock icon on unpaid months,
   tutes list with download buttons.
3. Lesson player: video area with a faint moving watermark "BR-1042 · 077 xxx 4521", title, notes, next lesson,
   "Downloading is disabled to protect your teacher's work" note.
4. Pay: unpaid months list with checkboxes, total, "Pay by card (PayHere)" primary, "Upload bank slip" secondary,
   payment history with receipt links.
Include a Sinhala-language variant of the Home screen to check text length.
```

## B11. Student portal — Login and device limit (mobile 390 × 844)

```
Design 3 mobile screens:
1. Login: institute logo and name, phone number field with +94 prefix, password, "Stay signed in for 30 days" note,
   "Forgot password? Get an SMS code".
2. OTP screen: 6-digit code boxes, resend timer.
3. Device limit reached: "You're signed in on 2 devices" with the two devices listed (Samsung A14 · Chrome, last used
   today 7:40 AM; Laptop · Chrome, yesterday) and "Sign out this device and continue" buttons; small note explaining
   the 2-device rule protects the teacher's lessons.
```

## B12. ReMix+ gate app (mobile 390 × 844)

```
Design the ReMix+ gatekeeper app screens:
1. Class selection for today with an "Offline ready ✓ · synced 7:02 AM" status chip.
2. Scanning screen: big camera/NFC area, counter "164 / 180 in".
3. Result states as full-screen colour feedback: GREEN "Paid · Nimali Perera · BR-1042", RED "Oct 2026 fee not paid",
   AMBER "Card not found", each with name, photo placeholder and big text readable from 1 metre.
4. Offline banner "No internet · 23 scans waiting to sync" and the manual override with a 4-digit receipt code.
```

---

# PART C — Follow-up prompts (use after each screen)

```
Make a Sinhala version of this screen and fix any layout that breaks.
```
```
Show the empty state, loading (skeleton) state and error state for this screen.
```
```
Make a mobile version (390px) of this admin screen for an owner checking on their phone.
```
```
Create a dark mode version using the same tokens.
```
```
List the reusable components on this screen with their variants, so developers can build them in shadcn/ui.
```

---

# PART D — Order to design in

1. B5 Institute dashboard (sets the admin style)
2. B6 Bank slip queue and B7 Students
3. B10 and B11 Student portal
4. B3 and B4 Platform admin
5. B8 Website builder and B9 Institute site template
6. B1 and B2 Marketing site
7. B12 Gate app (after MVP)

After each screen: show it to one real teacher and one cashier, then adjust before moving on.
