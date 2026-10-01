# Graph Report - Remix  (2026-10-01)

## Corpus Check
- 192 files · ~138,550 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 1621 nodes · 3558 edges · 98 communities (84 shown, 10 thin omitted)
- Extraction: 88% EXTRACTED · 12% INFERRED · 0% AMBIGUOUS · INFERRED: 421 edges (avg confidence: 0.88)
- Token cost: 512,352 input · 0 output

## Community Hubs (Navigation)
- Claude Design Viewer Runtime
- Auth Needs & R1 Features
- Lead Pages Function
- API Modules & PR DoD
- Guides Pages (MDX)
- About & Find-Class Pages
- Pricing Billing Components
- Architecture & Platform Features
- Cashier Needs & Fee Features
- Business Model & Platform Needs
- For Teachers Page
- Lesson Protection Needs
- Website & Growth Needs (R2)
- About Page Components
- Demo Page, Sitemap & Robots
- Locale Layout & Root
- CLAUDE.md & Dev Guide Rules
- UI Package Dependencies
- Design System & Student Screens
- Root Tooling Config
- i18n ADR & Roadmap
- Live Class & Attendance Features
- Marketing Home & Student Me Designs
- Quality: DoR, DoD & NFRs
- Types Package Config
- Audience Pages Designs
- Tabs & Phone Mockups
- Fees Design: Slips & Cash
- Product Vision & Trust Needs
- Site Runtime Dependencies
- Site Dev Dependencies
- Brand, Logo & About Designs
- Parents, SMS & Settings
- Turborepo Pipeline
- Demo Lead Form
- Form Primitives & Error Summary
- Site TS Config
- Admin Mobile Designs
- Video Lessons & Feature Toggles
- Public Site & Student Login Designs
- Base TS Config
- Home Page Sections
- Pricing Page Sections
- Guides Design & Portal Nav
- Class Page & Pay Designs
- Lesson Player Designs
- Web Routing & Guards
- Next.js TS Config
- Lead Schema (Zod)
- Lead Validation & Errors
- DESIGN.md Rules
- Admin Dashboard Widgets
- Functions TS Config
- Attendance & Parent SMS
- DB Layer & Job Queues
- Auth & Session Decisions
- CI & Supply Chain
- Tenant Resolution & RLS
- Zoom Live Scheduling
- Integrations: PayHere & SMS
- PayHere Payment Flow
- Tenant Isolation Controls
- Library TS Config
- Fonts & 404 Page
- Find Your Class Logic
- Admin Classes Design
- Admin Students & Devices
- For Institutes Trust Content
- Staff & Platform Login
- i18n Messages & Request
- Config Package
- Prettier Config
- Site Scripts
- Turnstile Widget
- SSRF Guard & Monolith
- API App & Deploy Infra
- Dashboard Mockup Data
- MDX Components
- Site Header & Footer Designs
- Site Package Manifest
- Types TS Config
- UI TS Config
- Lead Data Retention
- Next.js Config
- @remix/types Ref
- ESLint Config Ref
- Tailwind PostCSS Ref
- Vitest Ref
- PostCSS Config
- Auth Module
- Students/Classes Module
- Tenants Module
- Host-only Cookies
- Tenant Brand Colour

## God Nodes (most connected - your core abstractions)
1. `R1 — Pilot MVP (3 pilot institutes run a full month)` - 107 edges
2. `cn()` - 74 edges
3. `03 Architecture` - 63 edges
4. `05 Roadmap — phases, milestones, risks, decisions` - 55 edges
5. `buttonClass()` - 41 edges
6. `toLocale()` - 40 edges
7. `ROUTES` - 36 edges
8. `Phase 3 — Money (weeks 8–11)` - 31 edges
9. `Container()` - 30 edges
10. `04 Quality — NFRs, DoD, testing, security, release` - 30 edges

## Surprising Connections (you probably didn't know these)
- `Original architecture sketch with api.remix.lk` --conceptually_related_to--> `Same-origin API: /api/v1/* on every host via edge proxy`  [AMBIGUOUS]
  DEVELOPMENT.md → docs/plan/03-architecture.md
- `Security scope (remix.lk, *.remix.lk, admin.remix.lk, api.remix.lk, repo)` --conceptually_related_to--> `Same-origin API: /api/v1/* on every host via edge proxy`  [AMBIGUOUS]
  SECURITY.md → docs/plan/03-architecture.md
- `Definition of Done (§7 original)` --semantically_similar_to--> `Definition of Done — story / PR`  [INFERRED] [semantically similar]
  DEVELOPMENT.md → docs/plan/04-quality.md
- `Phase 0 plan: build remix.lk (~3 weeks)` --semantically_similar_to--> `Phase 0 — remix.lk marketing site (done)`  [INFERRED] [semantically similar]
  DEVELOPMENT.md → docs/plan/05-roadmap.md
- `Original phase 1–5 outline (superseded by docs/plan)` --semantically_similar_to--> `Phase 1 — Foundation & walking skeleton (weeks 1–4)`  [INFERRED] [semantically similar]
  DEVELOPMENT.md → docs/plan/05-roadmap.md

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Bank slip approval flow** — design_claude_design_institute_dashboard_dc_bank_slips_waiting_widget, design_claude_design_admin_fees_dc_bank_slip_queue, design_claude_design_admin_fees_dc_slip_review_panel, design_claude_design_admin_fees_dc_slip_reference_check, design_claude_design_admin_fees_dc_reject_with_reason, design_claude_design_admin_fees_dc_fee_status [INFERRED 0.85]
- **Fee status gates access to lessons and live classes** — design_claude_design_admin_fees_dc_fee_status, design_claude_design_admin_lessons_dc_lesson_access_rule, design_claude_design_admin_live_classes_dc_auto_register_paid, design_claude_design_admin_live_classes_dc_zoom_name_lock, design_claude_design_admin_students_dc_device_limit [INFERRED 0.75]
- **Platform staff access accountability controls** — design_claude_design_staff_login_dc_platform_admin_login, design_claude_design_staff_login_dc_authenticator_code, design_claude_design_platform_admin_dc_impersonation, design_claude_design_platform_admin_dc_audit_log [INFERRED 0.85]
- **Month fee payment unlocks lessons and live classes** — design_claude_design_uploads_remix_lms_screens_prompts_month_unlock_rule, design_claude_design_student_pay_dc_payment_method, design_claude_design_student_pay_dc_bank_slip_upload, design_claude_design_student_pay_dc_card_success_receipt, design_claude_design_student_pay_dc_slip_sent, design_claude_design_student_classes_dc_class_page_locked, design_claude_design_student_live_dc_live_tab, design_claude_design_uploads_recca_labs_design_system_1_bank_slip_queue [INFERRED 0.85]
- **Anti-sharing protection against the three leaks** — design_claude_design_uploads_remix_claude_design_brief_three_leaks, design_claude_design_uploads_remix_claude_design_brief_protected_video, design_claude_design_uploads_remix_claude_design_brief_two_device_limit, design_claude_design_uploads_remix_claude_design_brief_zoom_name_lock, design_claude_design_lesson_player_dc_player_desktop, design_claude_design_student_login_dc_device_limit, design_claude_design_student_live_dc_live_now_join [INFERRED 0.85]
- **Per-active-student pricing presented across marketing pages** — design_claude_design_uploads_remix_claude_design_brief_per_active_student_pricing, design_claude_design_uploads_remix_claude_design_brief_active_student_definition, design_claude_design_pricing_dc_bill_calculator, design_claude_design_remix_home_dc_home_calculator, design_claude_design_for_teachers_dc_tutor_plan_example, design_claude_design_for_institutes_dc_institute_plan_example, design_claude_design_uploads_recca_labs_design_system_1_pricing_calculator [INFERRED 0.85]
- **Three payment paths (card, slip, cash/manual) into one ledger that drives the unlock rule** — docs_plan_02_features_fee_04, docs_plan_02_features_fee_05, docs_plan_02_features_fee_06, docs_plan_02_features_fee_07, docs_plan_02_features_fee_08, docs_plan_02_features_rule_ledger_first, docs_plan_02_features_rule_unlock, docs_plan_01_product_n_csh_3 [EXTRACTED 1.00]
- **Tenant isolation defence in depth (RLS, withTenant, fail-closed tenant id, DB roles, host-only same-origin, isolation suite)** — docs_plan_03_architecture_rls, docs_plan_03_architecture_withtenant, docs_plan_03_architecture_app_tenant_id, docs_plan_03_architecture_db_roles, docs_plan_03_architecture_same_origin_api, docs_plan_03_architecture_host_only_cookies, docs_plan_04_quality_tenant_isolation_suite, docs_plan_02_features_ten_01, docs_plan_04_quality_t1 [INFERRED 0.95]
- **Integrations behind swappable provider interfaces** — docs_plan_03_architecture_payment_provider, docs_plan_03_architecture_sms_provider, docs_plan_03_architecture_video_provider, docs_plan_03_architecture_meeting_provider, docs_plan_03_architecture_storage_provider, docs_plan_03_architecture_email_provider [EXTRACTED 1.00]
- **CI and supply-chain security controls** — _github_workflows_ci_check_job, _github_workflows_ci_pnpm_audit, _github_workflows_ci_gitleaks_job, _github_workflows_ci_semgrep_job, _github_dependabot_dependabot_config, pnpm_workspace_allowbuilds, pnpm_workspace_minimum_release_age_exclude [INFERRED 0.85]
- **/api/lead defense-in-depth controls** — apps_site_functions_readme_origin_check, apps_site_functions_readme_body_limits, apps_site_functions_readme_turnstile_verification, apps_site_functions_readme_waf_rate_limit, apps_site_functions_readme_leadrequestschema, apps_site_functions_readme_generic_errors, apps_site_functions_readme_pii_free_logging [EXTRACTED 1.00]
- **Zoom link-sharing countermeasures** — apps_site_src_content_guides_en_stop_zoom_link_sharing_waiting_room, apps_site_src_content_guides_en_stop_zoom_link_sharing_disable_rename, apps_site_src_content_guides_en_stop_zoom_link_sharing_per_student_links, apps_site_src_content_guides_en_stop_zoom_link_sharing_lock_meeting, apps_site_src_content_guides_en_stop_zoom_link_sharing_name_locked_join [EXTRACTED 1.00]

## Communities (98 total, 10 thin omitted)

### Community 0 - "Claude Design Viewer Runtime"
Cohesion: 0.06
Nodes (75): boot(), bundledBlob(), cdnScriptFor(), collectProps(), compileAttr(), compileTemplate(), contentKey(), createComponentFactory() (+67 more)

### Community 1 - "Auth Needs & R1 Features"
Cohesion: 0.09
Nodes (51): N-OWN-1: Know where the money stands this month, N-OWN-2: Move from current system without retyping, N-STU-4: Not get locked out unfairly, R1 — Pilot MVP (3 pilot institutes run a full month), 02 Features & business rules, AUTH-01 Student login: phone + password, stay signed in 30 days, AUTH-02 Forgot password via 6-digit SMS code, AUTH-03 2-device limit with self-service sign-out (+43 more)

### Community 2 - "Lead Pages Function"
Cohesion: 0.08
Nodes (38): BASE_HEADERS, BodyTooLarge, countryOf(), Env, ErrorCode, fail(), FieldIssue, handleLead() (+30 more)

### Community 3 - "API Modules & PR DoD"
Cohesion: 0.06
Nodes (42): PR Definition of Done checklist, attendance module (QR/NFC scans, ReMix+ gate sync), AuditInterceptor (money/role/settings changes to audit_logs), BullMQ job processors (SMS, receipts, reports, webhooks, PDF watermark), fees module (invoices, payments, bank-slip queue, cash counter, receipts), lessons module (video, PDFs, month locking, watermarking), live module (Zoom OAuth, sessions, registrant links, attendance import), MeetingProvider interface (Zoom) (+34 more)

### Community 4 - "Guides Pages (MDX)"
Cohesion: 0.10
Nodes (31): GuidesPage(), Props, colomboDate(), dynamicParams, generateMetadata(), GuidePage(), Props, FeaturedGuide() (+23 more)

### Community 5 - "About & Find-Class Pages"
Cohesion: 0.09
Nodes (33): AboutPage(), generateMetadata(), FindYourClassPage(), generateMetadata(), HELP, Props, ForInstitutesPage(), generateMetadata() (+25 more)

### Community 6 - "Pricing Billing Components"
Cohesion: 0.09
Nodes (36): AddonsTable(), price(), BillingContext, BillingProvider(), BillingToggle(), CYCLES, PlanPrice(), Cents (+28 more)

### Community 7 - "Architecture & Platform Features"
Cohesion: 0.07
Nodes (41): Planned product components (DataTable, StatusBadge, MoneyInput, ImpersonationBanner, VideoPlayer…), Core platform rules §4.1 (tenant_id + RLS, withTenant, cents/UTC, Zod, BullMQ, providers, audit_logs), MSG-01 SmsProvider interface + Text.lk adapter, MSG-07 Staff email via Resend, TEN-04 Custom domain (CNAME/TXT verify, SSL, primary/redirect), 03 Architecture, App shells: PlatformShell, AdminShell, PortalShell, apps/api (NestJS REST API) (+33 more)

### Community 8 - "Cashier Needs & Fee Features"
Cohesion: 0.10
Nodes (41): N-CSH-1: Clear the slip queue fast, N-CSH-2: Take cash at the counter without mistakes, N-CSH-3: Never mark a paid student unpaid, N-OWN-6: Reach parents and students quickly, N-STU-2: Pay without going to the office, Persona CSH: Cashier, FEE-01 Monthly invoices per active enrolment, FEE-02 Invoices tab with reminder SMS and export (+33 more)

### Community 9 - "Business Model & Platform Needs"
Cohesion: 0.11
Nodes (38): Log in as institute: 60 min limit (superseded), Active student (paid or logged in during 30-day cycle), Business model: base fee + per-active-student fee (Tutor / Institute / Enterprise / Lite), MoSCoW for R1 Pilot MVP, N-PST-1: Onboard a new institute in < 15 minutes, N-PST-2: Support without asking for passwords, N-PST-3: Bill institutes correctly, N-PST-4: See platform health at a glance (+30 more)

### Community 10 - "For Teachers Page"
Cohesion: 0.11
Nodes (25): ForTeachersPage(), generateMetadata(), Props, PlanExample(), Row, COUNTS, num, PricingCalculator() (+17 more)

### Community 11 - "Lesson Protection Needs"
Cohesion: 0.12
Nodes (33): N-OWN-3: Stop lessons being shared, N-STU-3: Watch lessons on a cheap phone and weak data, N-TCH-1: Publish lessons with little effort, P1 Lessons leaked to Telegram, P2 One account, ten students, P3 Chasing fees and bank slips, P5 Foreign tools priced per class card, ReMix vision: run hall, Zoom and fee counter from one system (+25 more)

### Community 12 - "Website & Growth Needs (R2)"
Cohesion: 0.12
Nodes (33): N-OWN-5: Own website without a developer, N-OWN-9: Understand trends, N-VIS-1: Find the right class and join, P4 Scattered tools (WhatsApp, Excel, Zoom, website), Persona VIS: Prospective student / visitor, R2 — General availability, ATT-05 Attendance reports, BIL-06 Plan change with proration (+25 more)

### Community 13 - "About Page Components"
Cohesion: 0.16
Nodes (17): generateMetadata(), Props, AboutHero(), Pilot(), Story(), ITEMS, Values(), ITEMS (+9 more)

### Community 14 - "Demo Page, Sitemap & Robots"
Cohesion: 0.12
Nodes (19): DemoPage(), Props, dynamic, dynamic, PAGES, DemoIntro(), STEPS, Faq() (+11 more)

### Community 15 - "Locale Layout & Root"
Cohesion: 0.12
Nodes (17): generateMetadata(), viewport, LanguageItem(), LanguageList(), LanguagePill(), LINKS, MobileMenu(), NavLink() (+9 more)

### Community 16 - "CLAUDE.md & Dev Guide Rules"
Cohesion: 0.10
Nodes (29): CLAUDE.md — rules for AI assistants, CLAUDE.md rules (code, design, i18n, money/time/data, security, tests, git), Repo map (apps/site, web, api; packages ui, types, config), Design tokens in packages/ui/src/theme.css (no hex in components), DEVELOPMENT.md — development guide, Rules for AI assistants (§8), Original architecture sketch with api.remix.lk, Demo/trial form: Turnstile + Pages Function + Zod + D1 lead store (+21 more)

### Community 17 - "UI Package Dependencies"
Cohesion: 0.08
Nodes (26): clsx, dependencies, clsx, tailwind-merge, devDependencies, react, @remix/config, @types/react (+18 more)

### Community 18 - "Design System & Student Screens"
Cohesion: 0.12
Nodes (26): About Recca Labs page, 3a/3e My classes (paid/unpaid badges), Me screen (profile, devices, language, parent), 6f/6g Payment history with receipts, Colour tokens (--brand, --brand-soft, --accent, --ink, --muted, --line, --surface, --canvas, status), Command palette (Ctrl/Cmd+K), Core components in packages/ui (shadcn/ui + Tailwind), DataTable component (+18 more)

### Community 19 - "Root Tooling Config"
Cohesion: 0.08
Nodes (24): description, devDependencies, prettier, prettier-plugin-tailwindcss, turbo, typescript, engines, node (+16 more)

### Community 20 - "i18n ADR & Roadmap"
Cohesion: 0.12
Nodes (24): ADR 0002 — i18n strategy (next-intl, native review), next-intl with [locale] segment, localePrefix always, One JSON message file per namespace; key types from English, PDPA No. 9 of 2022 legal constraint (minors, guardian consent, EU hosting), R0 — remix.lk (marketing site, shipped), Postgres 18 primary + standby, PgBouncer, WAL archiving, 14-day PITR, 05 Roadmap — phases, milestones, risks, decisions, ADR 0014 (planned): Postgres HA: Patroni vs managed (+16 more)

### Community 21 - "Live Class & Attendance Features"
Cohesion: 0.18
Nodes (24): N-OWN-4: Run Zoom classes without link sharing, N-STU-1: Get into today's class with one tap, N-TCH-2: Know who attended, Persona TCH: Teacher, ATT-01 Attendance record model (zoom/gate/manual/qr), ATT-02 Manual attendance marking, ATT-03 Dashboard present today + absent list, LIV-01 Connect with Zoom (OAuth) (+16 more)

### Community 22 - "Marketing Home & Student Me Designs"
Cohesion: 0.18
Nodes (20): A Saturday with ReMix timeline, Weekly timetable (halls + Zoom), Features grid (website, fees, video, Zoom, gate, parents), Three leaks dark band, 1c Device limit reached screen, Devices 2 of 2 with Sign out, Student card QR for the hall gate, Parent link (gets SMS for fees and attendance) (+12 more)

### Community 23 - "Quality: DoR, DoD & NFRs"
Cohesion: 0.13
Nodes (23): UI PR review checklist, Definition of Done (§7 original), Security full checklist §5 (release gate: all Must items), Saturday peak load constraint (4,000 logins in 2 min per cell), 04 Quality — NFRs, DoD, testing, security, release, Definition of Ready (feature + need IDs, design, API contract, RLS plan, ≤ 3 days), Definition of Done — feature / epic (staging, realistic volume, graph refreshed), Definition of Done — phase (exit criteria, no P1/P2, threat model updated) (+15 more)

### Community 24 - "Types Package Config"
Cohesion: 0.09
Nodes (22): dependencies, zod, devDependencies, @remix/config, typescript, vitest, exports, ./lead (+14 more)

### Community 25 - "Audience Pages Designs"
Cohesion: 0.14
Nodes (20): For Institutes page, Institute plan example (800 students), For Teachers page, Switch in three steps (free data migration), Tutor plan example (120 students), What counts as an active student? explainer, Add-ons table, Work out your bill calculator (students + classes sliders) (+12 more)

### Community 26 - "Tabs & Phone Mockups"
Cohesion: 0.15
Nodes (14): TabItem, Tabs(), LessonRow(), ParentPhone(), PhoneFrame(), TabBar(), ButtonSize, ButtonVariant (+6 more)

### Community 27 - "Fees Design: Slips & Cash"
Cohesion: 0.15
Nodes (20): Bank slip queue (11a), Cash counter (11c), Cash counter · mobile (11f), Cash received and change calculation, Fee status: Paid / Unpaid / Overdue / Slip waiting, Fees tabs: Invoices / Payments / Bank slips / Cash counter, Invoice number format (KP-I-YY-MM-NNNN), Invoices list (11d) (+12 more)

### Community 28 - "Product Vision & Trust Needs"
Cohesion: 0.14
Nodes (20): routing.locales lists only live locales (native-reviewed), 01 Product — vision, users, needs, scope, Institute collects fees via its own PayHere merchant (ReMix never holds institute money), N-GTE-1: Let paid students in quickly, even offline, N-OWN-7: Trust the system with data and income, N-OWN-8: Control what staff can do, N-STU-5: Use it in my language, Explicit non-goals (not a payment processor, not a general LMS, no social features, no AI si/ta copy) (+12 more)

### Community 29 - "Site Runtime Dependencies"
Cohesion: 0.11
Nodes (19): dependencies, lucide-react, @mdx-js/loader, @mdx-js/react, next, next-intl, @next/mdx, react (+11 more)

### Community 30 - "Site Dev Dependencies"
Cohesion: 0.11
Nodes (19): devDependencies, @cloudflare/workers-types, eslint, @remix/config, tailwindcss, @types/mdx, @types/node, @types/react (+11 more)

### Community 31 - "Brand, Logo & About Designs"
Cohesion: 0.11
Nodes (15): Pilot institutes program (Join the pilot), Recca Labs (Colombo software company), Brand logo spec (blue online stroke, amber hall stroke, Bricolage Grotesque ExtraBold), Home hero 'Run your whole class, online and in the hall.', ReMix wordmark 'by Recca Labs', LIVE NOW card with Join class, 5c Desktop Live, 5b Live now join sheet (name set by institute) (+7 more)

### Community 32 - "Parents, SMS & Settings"
Cohesion: 0.15
Nodes (19): N-PAR-1: Know my child attended, N-PAR-2: Know what's owed, Persona PAR: Parent / guardian, Module MSG: Messages & notifications, Module SET: Settings & integrations, MSG-02 ReMix SMS wallet, MSG-03 Compose SMS with segment/cost preview, MSG-04 System SMS templates per locale (+11 more)

### Community 33 - "Turborepo Pipeline"
Cohesion: 0.11
Nodes (18): ^build, dist/**, !.next/cache/**, dependsOn, outputs, cache, persistent, .next/** (+10 more)

### Community 34 - "Demo Lead Form"
Cohesion: 0.16
Nodes (16): EMPTY, ErrorField, ErrorKind, Errors, FIELDS, LeadFormFromUrl(), isErrorField(), LeadForm() (+8 more)

### Community 35 - "Form Primitives & Error Summary"
Cohesion: 0.25
Nodes (14): Reason, ErrorSummary(), ErrorSummaryItem, AffixInput(), Checkbox(), controlClass(), Field(), FieldError() (+6 more)

### Community 36 - "Site TS Config"
Cohesion: 0.11
Nodes (17): compilerOptions, baseUrl, paths, exclude, extends, include, .next, out (+9 more)

### Community 37 - "Admin Mobile Designs"
Cohesion: 0.16
Nodes (18): Classes and class detail · mobile (8d/8e), Admin mobile bottom tab bar (Home / Students / Fees / Classes / More), More menu · mobile (17b), Admin Dashboard Mobile design (17a/17b), Printed receipt + SMS receipt, Settings tabs: General / Staff and roles / Integrations / Subscription / Domain / Receipts, Add lesson · uploading video (9b), Lesson status lifecycle: Uploading -> Processing -> Ready / Scheduled (+10 more)

### Community 38 - "Video Lessons & Feature Toggles"
Cohesion: 0.16
Nodes (18): Own Bunny account (Enterprise plan only), ReMix protected video monthly quota (212 / 500 GB), Add lesson · YouTube link (9c), Protected video lesson source, YouTube videos are unprotected, use for free previews only, Institute audit log, Per-institute feature toggles, Log in as admin (recorded impersonation, 14c) (+10 more)

### Community 39 - "Public Site & Student Login Designs"
Cohesion: 0.18
Nodes (15): 7a Institute public home desktop, 7b Institute public home mobile, 4c YouTube free preview mode, 1d Desktop login, 1a Student login (+94 phone, password), 1b SMS code (6-digit), B9 Institute public website template prompt, Institute admin journey (/admin) (+7 more)

### Community 40 - "Base TS Config"
Cohesion: 0.11
Nodes (17): compilerOptions, esModuleInterop, forceConsistentCasingInFileNames, isolatedModules, lib, module, moduleResolution, noEmit (+9 more)

### Community 41 - "Home Page Sections"
Cohesion: 0.18
Nodes (10): generateMetadata(), Props, Features, Hero(), PricingBand(), ITEMS, Problems(), ScreensTour() (+2 more)

### Community 42 - "Pricing Page Sections"
Cohesion: 0.18
Nodes (11): generateMetadata(), Props, ActiveStudents(), bold(), ITEMS, CalculatorBand(), PricingCta(), faqValues (+3 more)

### Community 43 - "Guides Design & Portal Nav"
Cohesion: 0.17
Nodes (14): Featured guide: How to start an online tuition class in Sri Lanka, Guides page (category filter), Class cards with monthly fee and Enrol, Screens tour (Admin / Student / Parent tabs), Bottom tab bar Home / Classes / Pay / Live / Me, Cash counter (cashier mode), Institute admin <institute-domain>/admin, Marketing site remix.lk (+6 more)

### Community 44 - "Class Page & Pay Designs"
Cohesion: 0.16
Nodes (13): 3c/3d Class page unpaid month locked, 3b Class page paid month, Fee due banner with Pay now, 6c Upload bank slip, 6d Card paid, October unlocked + receipt, 6b Choose payment method (card vs bank slip), 6e Slip sent (waiting for office), 6a Unpaid months selection (+5 more)

### Community 45 - "Lesson Player Designs"
Cohesion: 0.21
Nodes (11): 'Downloading is disabled to protect your teacher's work' note, 4a Lesson player desktop (protected video), 4b Lesson player mobile, ReMix LMS screens index (all areas), 2b Student home desktop, 2a Student home mobile, Video player with watermark layer, B10 Student portal Home/Class/Player/Pay prompt (+3 more)

### Community 46 - "Web Routing & Guards"
Cohesion: 0.19
Nodes (13): AuthGuard, RolesGuard (deny by default), website module (page-builder blocks, data only, never raw HTML), (tenant)/admin institute admin - light sidebar shell, (platform) area - admin.remix.lk staff shell, TOTP required, proxy.ts (host to area rewrite, security headers, CSP nonce), Re-check session and role in every server action (UI hiding is not authorization), requireRole() / requireStaff() session helpers (+5 more)

### Community 47 - "Next.js TS Config"
Cohesion: 0.15
Nodes (12): compilerOptions, allowJs, incremental, jsx, lib, plugins, extends, DOM (+4 more)

### Community 48 - "Lead Schema (Zod)"
Cohesion: 0.19
Nodes (10): Lead, LEAD_LIMITS, LeadField, LeadInput, LeadRequest, leadRequestSchema, leadSchema, sriLankaMobile (+2 more)

### Community 49 - "Lead Validation & Errors"
Cohesion: 0.18
Nodes (12): Error filter (no stack traces or SQL in responses), ZodValidationPipe (schemas from @remix/types, strict objects), POST /api/lead (functions/api/lead.ts), JSON content-type, 8 KB streamed body cap, strict UTF-8, Generic error responses (invalid_input / verification_failed / server_error), leadRequestSchema (@remix/types/lead, strict object, +947 mobile normalisation), functions/_lib helpers (non-route), Same-origin check (Origin allowlist, Sec-Fetch-Site, no CORS) (+4 more)

### Community 50 - "DESIGN.md Rules"
Cohesion: 0.17
Nodes (12): DESIGN.md — design system & UI map, Patterns & content rules (money, dates, empty/loading/error, destructive, honesty), Design principles (trust first, fast, cheap phone, three languages, one system three moods), Process: implementing a screen from a .dc.html file, Screen → route map (site, portal, institute admin, platform admin), Rule: status is word + icon + colour, never colour alone, Tenant theming: only brand/brand-hover/brand-soft/accent overridable, contrast validated, Typography (Bricolage Grotesque, Geist, Noto Sans Sinhala/Tamil) (+4 more)

### Community 51 - "Admin Dashboard Widgets"
Cohesion: 0.24
Nodes (12): Admin home · mobile (17a), Approve / Reject / Skip keyboard shortcuts (A / R / S), Times shown in Asia/Colombo, Bank slips waiting widget, Fees collected KPI (month progress), Global search (Ctrl K), EN / Sinhala / Tamil language switcher, Payment methods: card, cash, bank slip (+4 more)

### Community 52 - "Functions TS Config"
Cohesion: 0.18
Nodes (10): compilerOptions, lib, types, extends, include, ES2023, @remix/config/tsconfig.base.json, $schema (+2 more)

### Community 53 - "Attendance & Parent SMS"
Cohesion: 0.22
Nodes (11): Record payment action, Absent SMS to parents, Download attendance CSV, Attendance status: Present / Late / Left early / Absent, Session detail · attendance from Zoom (10d), Student recent activity feed, Parent contact, Profile tabs: Overview / Classes / Payments / Attendance / Devices / Parent (+3 more)

### Community 54 - "DB Layer & Job Queues"
Cohesion: 0.24
Nodes (11): OTP SMS always from ReMix wallet, rate-limited; messages queued, app_tenant_id() — NULL when unset → zero rows, packages/db (Drizzle schema, migrations, RLS policies, withTenant), Principle: slow work is async (BullMQ), p95 < 300 ms, BullMQ queue: email, BullMQ queue: sms, BullMQ queue: zoom, withTenant(tenantId, tx) — SET LOCAL app.tenant_id (+3 more)

### Community 55 - "Auth & Session Decisions"
Cohesion: 0.22
Nodes (11): Session rule: 15-min access + rotating refresh cookie; password change revokes all, Argon2id password hashing (OWASP params), Better Auth (evaluated in Phase 1; fallback own implementation), Observability (Sentry, OTel, Prometheus, Loki, Uptime Kuma), DB-backed sessions with rotating refresh token + reuse detection, ADR 0003 (planned): Same-origin /api/v1 on every host via edge proxy, ADR 0004 (planned): Better Auth vs own auth, ADR 0013 (planned): Observability stack (+3 more)

### Community 56 - "CI & Supply Chain"
Cohesion: 0.24
Nodes (10): Dependabot config (weekly npm + github-actions, grouped updates), CI job: Lint, typecheck, test, build, CI workflow (PRs + push to main, least-privilege GITHUB_TOKEN), CI job: Secret scan (gitleaks), pnpm audit --audit-level high, CI job: Static analysis (Semgrep typescript/react/secrets), site-out build artifact (apps/site/out), allowBuilds deny-by-default install scripts (+2 more)

### Community 57 - "Tenant Resolution & RLS"
Cohesion: 0.22
Nodes (10): packages/db (Drizzle schema, migrations, withTenant), PostgreSQL Row Level Security (tenant_id on every tenant table), TenantContext (from verified host/session), withTenant() helper, remix.lk Cloudflare Pages Functions, getTenant() from host (server/tenant.ts), Server-side tenant resolution from Host header, remix.lk deploy to Cloudflare Pages (apps/site/out) (+2 more)

### Community 58 - "Zoom Live Scheduling"
Cohesion: 0.27
Nodes (10): Scan student card or search name / number / phone, Zoom integration (create meetings, register students, read attendance), Live classes and schedule sheet · mobile (10e/10f), Recurring schedule (Repeat every Saturday), Schedule live class dialog (10c), Admin Live Classes design (P10), Live class sessions list (10b), Zoom name lock (student name + number) (+2 more)

### Community 59 - "Integrations: PayHere & SMS"
Cohesion: 0.33
Nodes (10): Integrations · mobile (13c) and PayHere settings · mobile (13d), Own SMS gateway (Text.lk or any HTTP API), PayHere card payments integration, Sandbox / Live payment mode, Admin Integrations design (P13), SMS sender ID, ReMix SMS wallet (prepaid SMS), Test payment (LKR 10) (+2 more)

### Community 60 - "PayHere Payment Flow"
Cohesion: 0.24
Nodes (10): FEE-04 PayHere checkout with institute's own merchant, PayHere notify verification (md5sig, amount, LKR, idempotent on payment_id; redirect never trusted), PayHere (institute merchant) integration, PaymentProvider interface, provider_events webhook inbox (unique event id, idempotency), BullMQ queue: payments, Webhooks /api/v1/webhooks/{payhere,zoom,bunny,textlk}, Threat T4: Fake "paid" (forged PayHere redirect/notify, replay) (+2 more)

### Community 61 - "Tenant Isolation Controls"
Cohesion: 0.38
Nodes (10): TEN-01 Resolve tenant from Host header (unknown host → 404), DB roles: remix_owner / remix_app (NOBYPASSRLS) / remix_platform / remix_readonly, Isolation test harness + CI check (every tenant table has tenant_id + RLS), Platform cross-tenant SQL views owned by remix_platform, Postgres Row Level Security on every tenant table, J-12 Tenant A staff cannot see tenant B data (host swap, id guessing), Threat T1: Tenant data leak (bug or IDOR), Generated tenant isolation test suite (every PR, must pass) (+2 more)

### Community 62 - "Library TS Config"
Cohesion: 0.20
Nodes (9): compilerOptions, jsx, lib, extends, DOM, DOM.Iterable, ES2023, ./tsconfig.base.json (+1 more)

### Community 63 - "Fonts & 404 Page"
Cohesion: 0.25
Nodes (7): NotFound(), bricolage, fontVariables, geist, geistMono, notoSinhala, notoTamil

### Community 64 - "Find Your Class Logic"
Cohesion: 0.28
Nodes (6): FindClassForm(), onSubmit(), CLASS_DOMAIN, FindClassResult, parseClassAddress(), RESERVED_SLUGS

### Community 65 - "Admin Classes Design"
Cohesion: 0.36
Nodes (9): A/L year / O/L class filter, Class delivery mode: Hall / Online / Hall + Zoom, Class detail · Students tab (8c), Class detail tabs: Students / Schedule / Lessons / Fees / Attendance, Monthly class fee (LKR), Classes list · desktop (8a), Create class dialog (8b), Paid this month % per class (+1 more)

### Community 66 - "Admin Students & Devices"
Cohesion: 0.31
Nodes (9): ReMix subscription usage meter in More menu, Bulk actions: Send SMS / Move class / Mark paid / Sign out devices, Device limit (2 signed-in devices per student), Import students CSV, Student profile · Devices (12c), Admin Students design (P12), Students and student profile · mobile (12e/12f), Students table with bulk selection (12a) (+1 more)

### Community 67 - "For Institutes Trust Content"
Cohesion: 0.25
Nodes (8): Audit log (who approved payments / changed fees), Book a demo request form (WhatsApp follow-up), Recorded support sessions with banner, Role-scoped views: Owner / Teacher / Cashier / Gatekeeper, Data kept separate per institute, Home FAQ (data safety, migration, payments, languages, offline), Impersonation banner (Recca support viewing), Institute roles: owner, admin, teacher, cashier, gatekeeper

### Community 68 - "Staff & Platform Login"
Cohesion: 0.36
Nodes (9): Platform admin authenticator code (15f), Continue with Google Workspace, Separate login surfaces for students, institute staff and platform staff, Platform admin login (15e/15g), Staff Login design (P15), Security key sign-in option, Institute staff login (15a/15c), Institute staff 2-step SMS code (15b/15d) (+1 more)

### Community 69 - "i18n Messages & Request"
Cohesion: 0.32
Nodes (5): AppConfig, Messages, Namespace, NAMESPACES, next-intl

### Community 70 - "Config Package"
Cohesion: 0.25
Nodes (7): files, tsconfig.base.json, name, private, version, tsconfig.library.json, tsconfig.nextjs.json

### Community 71 - "Prettier Config"
Cohesion: 0.25
Nodes (7): plugins, printWidth, semi, singleQuote, tailwindStylesheet, trailingComma, prettier-plugin-tailwindcss

### Community 72 - "Site Scripts"
Cohesion: 0.29
Nodes (7): scripts, build, dev, lint, start, test, typecheck

### Community 73 - "Turnstile Widget"
Cohesion: 0.33
Nodes (6): loadTurnstile(), Turnstile(), TURNSTILE_ACTION, TurnstileApi, TurnstileOptions, Window

### Community 74 - "SSRF Guard & Monolith"
Cohesion: 0.33
Nodes (7): Recommended changes to the earlier plan (static site, Better Auth, Argon2id, DB HA, private network, private R2, SSRF, modular monolith), apps/site as Next.js static export on Cloudflare Pages + Pages Functions/D1, MSG-05 Own SMS gateway (SSRF-guarded), BYO SMS gateway generic HTTP adapter (R2), Modular monolith (one NestJS API, one Next.js app, one worker), SSRF guard (https only, public IPs, no redirects, 5 s timeout), Threat T10: SSRF via BYO SMS gateway

### Community 75 - "API App & Deploy Infra"
Cohesion: 0.40
Nodes (6): apps/api NestJS modular monolith (Phase 1), /health endpoint for Kamal deploys, main.ts (helmet, CORS allowlist, body limits, trust proxy Cloudflare only), api-client.ts (typed fetch to apps/api with user session), Hetzner firewall (443 from Cloudflare ranges only), infra/deploy Kamal config + hardened server bootstrap

### Community 76 - "Dashboard Mockup Data"
Cohesion: 0.33
Nodes (5): CLASSES, NAV, PAYMENTS, SLIPS, Status()

### Community 77 - "MDX Components"
Cohesion: 0.40
Nodes (4): components, MdxLink(), slugify(), textOf()

### Community 78 - "Site Header & Footer Designs"
Cohesion: 0.40
Nodes (4): B1 Marketing Home page, Site footer (Product / Company / Legal, language list), Site header (nav, language pill, Find your class, Start free), Find your class (route students to their institute site)

### Community 79 - "Site Package Manifest"
Cohesion: 0.40
Nodes (4): name, private, type, version

### Community 80 - "Types TS Config"
Cohesion: 0.40
Nodes (4): extends, include, @remix/config/tsconfig.base.json, src

### Community 81 - "UI TS Config"
Cohesion: 0.40
Nodes (4): extends, include, src, @remix/config/tsconfig.library.json

### Community 82 - "Lead Data Retention"
Cohesion: 0.50
Nodes (4): D1 database remix-site-leads (leads table), Lead data retention (delete after 24 months), Data protection policy page (/en/data-protection/), security.txt (security@remix.lk, expires 2027-09-30, en/si/ta)

### Community 83 - "Next.js Config"
Cohesion: 0.50
Nodes (3): config, withMDX, withNextIntl

## Ambiguous Edges - Review These
- `Same-origin API: /api/v1/* on every host via edge proxy` → `Original architecture sketch with api.remix.lk`  [AMBIGUOUS]
  DEVELOPMENT.md · relation: conceptually_related_to
- `Same-origin API: /api/v1/* on every host via edge proxy` → `Security scope (remix.lk, *.remix.lk, admin.remix.lk, api.remix.lk, repo)`  [AMBIGUOUS]
  SECURITY.md · relation: conceptually_related_to

## Knowledge Gaps
- **337 isolated node(s):** `singleQuote`, `semi`, `trailingComma`, `printWidth`, `prettier-plugin-tailwindcss` (+332 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 394 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **10 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **What is the exact relationship between `Same-origin API: /api/v1/* on every host via edge proxy` and `Original architecture sketch with api.remix.lk`?**
  _Edge tagged AMBIGUOUS (relation: conceptually_related_to) - confidence is low._
- **What is the exact relationship between `Same-origin API: /api/v1/* on every host via edge proxy` and `Security scope (remix.lk, *.remix.lk, admin.remix.lk, api.remix.lk, repo)`?**
  _Edge tagged AMBIGUOUS (relation: conceptually_related_to) - confidence is low._
- **Why does `R1 — Pilot MVP (3 pilot institutes run a full month)` connect `Auth Needs & R1 Features` to `Parents, SMS & Settings`, `Architecture & Platform Features`, `Cashier Needs & Fee Features`, `Business Model & Platform Needs`, `Lesson Protection Needs`, `Website & Growth Needs (R2)`, `PayHere Payment Flow`, `i18n ADR & Roadmap`, `Live Class & Attendance Features`, `Product Vision & Trust Needs`, `Tenant Isolation Controls`?**
  _High betweenness centrality (0.024) - this node is a cross-community bridge._
- **Why does `05 Roadmap — phases, milestones, risks, decisions` connect `i18n ADR & Roadmap` to `Parents, SMS & Settings`, `Auth Needs & R1 Features`, `Architecture & Platform Features`, `Cashier Needs & Fee Features`, `Business Model & Platform Needs`, `Lesson Protection Needs`, `Website & Growth Needs (R2)`, `PayHere Payment Flow`, `CLAUDE.md & Dev Guide Rules`, `DESIGN.md Rules`, `Quality: DoR, DoD & NFRs`, `Live Class & Attendance Features`, `DB Layer & Job Queues`, `Auth & Session Decisions`, `Product Vision & Trust Needs`, `Tenant Isolation Controls`?**
  _High betweenness centrality (0.022) - this node is a cross-community bridge._
- **Why does `03 Architecture` connect `Architecture & Platform Features` to `Auth Needs & R1 Features`, `Cashier Needs & Fee Features`, `Business Model & Platform Needs`, `SSRF Guard & Monolith`, `Lesson Protection Needs`, `CLAUDE.md & Dev Guide Rules`, `DESIGN.md Rules`, `i18n ADR & Roadmap`, `Live Class & Attendance Features`, `DB Layer & Job Queues`, `Auth & Session Decisions`, `PayHere Payment Flow`, `Tenant Isolation Controls`?**
  _High betweenness centrality (0.015) - this node is a cross-community bridge._
- **What connects `singleQuote`, `semi`, `trailingComma` to the rest of the system?**
  _337 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Claude Design Viewer Runtime` be split into smaller, more focused modules?**
  _Cohesion score 0.060678962844159315 - nodes in this community are weakly interconnected._