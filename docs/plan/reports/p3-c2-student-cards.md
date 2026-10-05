# p3-c2-student-cards report

- Status: done
- Branch / PR: `feat/p3-c2-student-cards` / https://github.com/ReccaLabs/Remix/pull/54 — ready for review, base `main`; not merged.
- Feature IDs: done: STU-07, STU-06, FEE-07 card scanning | not done: none
- Gates: lint · typecheck · build passed. Tests passed: API 939, db 403, web 433, types 146, ui 58, site 77. Local package tests used Turbo cache; fresh card E2E passed on desktop/mobile with axe and 390/768/1024/1440 checks; full CI journeys passed.
- CI: 6/6 pass — lint/typecheck/test/build · tenant isolation (Postgres 18) · E2E journeys · API image/build/smoke/Trivy · gitleaks · Semgrep.
- Migrations added: `packages/db/migrations/0015_student_cards.sql`, `0016_student_cards_rls.sql`; rewritten in place with matching snapshots/journal.
- Contract changes (packages/types): none; lead's card contract preserved.
- New dependencies: `uqr@0.1.3` — pinned, zero-dependency SVG QR encoder for permanent card sheets; production dependency audit reports zero advisories.
- Security-relevant changes:
  - Tenant RLS forced, composite tenant FKs, minimal column grants and no DELETE: `packages/db/migrations/0016_student_cards_rls.sql`.
  - Normalised student-number uniqueness without renumbering; import collision errors: `packages/db/migrations/0015_student_cards.sql`, `apps/api/src/modules/imports/row-validator.ts`, `import-runner.ts`.
  - Per-student locks, permanent code/UID reservation, atomic replacement and irreversible lifecycle: `apps/api/src/modules/people/cards.service.ts`, `packages/db/migrations/0016_student_cards_rls.sql`.
  - Permission guards, session lookup limits, no-store responses, UID hints and log/audit redaction: `apps/api/src/modules/people/cards.controller.ts`, `cards.service.ts`, `apps/api/src/common/logging/logger.ts`, `apps/api/src/modules/audit/audit.service.ts`.
  - CSV formula injection protection: `apps/web/src/lib/cards-csv.ts`.
  - Camera allowed only on admin pages; scanner streams aborted on close/unmount: `apps/web/src/proxy.ts`, `apps/web/src/lib/security-headers.ts`, `apps/web/src/components/fees/camera-card-scanner.tsx`.
- Deviations from plan/ADRs: none; numbering/card amendment recorded in ADR 0007.
- Known issues / TODO: none. Physical reader/camera/NFC hardware was not exercised; browser capability, scan handling and cleanup have automated coverage.
- Review these files first (max 10): `packages/db/src/counters.ts`, `packages/db/src/provision.ts`, `packages/db/migrations/0015_student_cards.sql`, `packages/db/migrations/0016_student_cards_rls.sql`, `apps/api/src/modules/people/cards.service.ts`, `apps/api/test/integration/cards.int.test.ts`, `apps/web/src/components/students/card-panel.tsx`, `apps/web/src/components/students/ordered-cards.tsx`, `apps/web/src/components/fees/cash-counter.tsx`, `e2e/tests/student-cards.spec.ts`.
