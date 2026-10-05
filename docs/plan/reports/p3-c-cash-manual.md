# p3-c-cash-manual report

- Status: done
- Branch / PR: `feat/p3-c-cash-manual` / https://github.com/ReccaLabs/Remix/pull/53
- Feature IDs: done: FEE-07, FEE-08, FEE-10 (checkpoints a–h) | not done: none
- Gates: lint · typecheck · build passed; tests: API 918, db 379, web 402, UI 58, types 141, site 77 passed; 27 jobs/receipt/boot regression tests passed after the development wiring fix. Cash journey passed in Chromium and mobile Chrome; keyboard-only collection, axe and responsive checks at 390/768/1024/1440 passed.
- CI: all 6 pass — lint/typecheck/test/build; tenant isolation (Postgres 18); E2E journeys; API image/build/smoke/Trivy; gitleaks; Semgrep.
- Migrations added: none
- Contract changes (packages/types): none
- New dependencies: none
- Security-relevant changes:
  - Tenant-scoped locks, ownership/open-balance validation and body-bound idempotency: `apps/api/src/modules/fees/collection.ts`.
  - `fees.collect` guards, student-only `myFees`, no-store responses: `apps/api/src/modules/fees/fees.controller.ts`; own-data projection excludes staff surplus fields and integration secrets: `apps/api/src/modules/fees/fees.service.ts`.
  - Actor audit includes request fingerprint and manual kind: `apps/api/src/modules/fees/ledger.ts`. Existing allocation, receipt, projection and after-commit PDF paths reused.
- Deviations from plan/ADRs: status filter withdrawn by lead; only contract filters rendered. Minimal ledger change adds audit metadata only. Registered the existing receipt runner in development inline jobs: cash receipts previously blocked subsequent SMS/import jobs (`apps/api/src/jobs/jobs.module.ts`). Manual business dates use UTC noon to preserve the Colombo date. Dashboard has no quick-actions area, so no dashboard action was added.
- Known issues / TODO: planned deferrals only — `slips: []` for 3-D; checkout for 3-E; SMS/invoices/reminders for 3-F. USB scanners type into name/phone search; no student-card model exists.
- Review these files first (max 10): `apps/api/src/modules/fees/collection.ts`, `apps/api/src/modules/fees/ledger.ts`, `apps/api/src/modules/fees/fees.service.ts`, `apps/api/src/modules/fees/fees.controller.ts`, `apps/api/src/jobs/jobs.module.ts`, `apps/api/test/integration/fees-collection.int.test.ts`, `apps/web/src/components/fees/cash-counter.tsx`, `apps/web/src/components/fees/manual-payment-dialog.tsx`, `apps/web/src/components/fees/payment-history.tsx`, `e2e/tests/cash-manual.spec.ts`.
