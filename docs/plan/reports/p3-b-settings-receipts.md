# p3-b-settings-receipts report

- Status: done
- Branch / PR: `feat/p3-b-settings-receipts` / https://github.com/ReccaLabs/Remix/pull/52
- Feature IDs: done: SET-02, SET-03, FEE-09, FEE-12 settings | not done: none in scope
- Gates: lint pass · typecheck pass · build pass · tests: API 882, web 388, DB 379, types 141, UI 58, site 77. Chromium/axe at 390/768/1024/1440; 48 px actions, save/reload, checkout auto-POST and 72 mm print width verified. [Screenshots](https://github.com/ReccaLabs/Remix/tree/feat/p3-b-settings-receipts/docs/plan/reports/assets/p3-b-settings-receipts).
- CI: 6/6 pass — lint/typecheck/test/build · tenant isolation · E2E · API image/smoke/Trivy · gitleaks · Semgrep.
- Migrations added: `packages/db/migrations/0013_settings_receipts.sql`, `packages/db/migrations/0014_settings_receipts_rls.sql`
- Contract changes (packages/types): none
- New dependencies: none; minimal PDF writer has escaping, pagination, byte-offset and stream-length tests.
- Security-relevant changes:
  - Forced tenant RLS, narrow column grants and isolation tests — `packages/db/migrations/0014_settings_receipts_rls.sql`, `packages/db/test/money-settings.test.ts`.
  - AES-256-GCM, tenant AAD, fresh 96-bit nonces, explicit 128-bit tags and key IDs; production key required — `apps/api/src/integrations/secret-box.ts`, `apps/api/src/config/config.ts`.
  - Owner-only money settings; secret hints only, redacted logs and secret-free audits — `apps/api/src/modules/fees/money-settings.controller.ts`, `apps/api/src/modules/fees/payhere-settings.service.ts`, `apps/api/src/common/logging/logger.ts`.
  - Server-side signing follows [PayHere's checkout protocol](https://support.payhere.lk/api-%26-mobile-sdk/checkout-api); exact gateway form-action allowlist — `apps/api/src/integrations/payment/payhere-checkout-builder.ts`, `apps/web/src/lib/security-headers.ts`.
  - After-commit PDF jobs lock receipts and reuse deterministic private keys; staff permission/student ownership precedes ten-minute signing — `apps/api/src/modules/fees/receipt-jobs.ts`, `apps/api/src/modules/fees/receipts.service.ts`.
- Deviations from ADRs: none
- Known issues / TODO: 3-D must bind production storage; 3-E must persist test checkouts and verify callbacks (last-test status remains pending). PDF is a Latin-only text snapshot; embed Unicode fonts and add Sinhala/Tamil shaping before those locales launch. Existing PDFs retain issuance data; live thermal reprints reflect later reversals. No live merchant payment was attempted. All started processes stopped; PR remains unmerged.
- Review these files first (max 10): `packages/db/migrations/0013_settings_receipts.sql`, `packages/db/migrations/0014_settings_receipts_rls.sql`, `apps/api/src/integrations/secret-box.ts`, `apps/api/src/modules/fees/money-settings.controller.ts`, `apps/api/src/modules/fees/payhere-settings.service.ts`, `apps/api/src/modules/fees/fee-settings.service.ts`, `apps/api/src/modules/fees/receipt-jobs.ts`, `apps/api/src/modules/fees/receipts.service.ts`, `apps/api/src/modules/fees/receipt-pdf.ts`, `apps/api/test/integration/receipts.int.test.ts`.
