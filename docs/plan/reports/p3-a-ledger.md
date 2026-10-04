# p3-a-ledger report

- Status: blocked
- Branch / PR: https://github.com/ReccaLabs/Remix/tree/feat/p3-a-ledger (PR pending)
- Feature IDs: done: none | not done: FEE-01, FEE-11, ledger engine and endpoints
- Gates: lint ✅ · typecheck ✅ · build ✅ · tests: api 797 ✅, web 380 ✅, db 299 ✅, types 137 ✅, ui 58 ✅ (baseline; all except types cached)
- CI: Lint · typecheck · test · build pending; Tenant isolation (Postgres 18) pending; E2E journeys (Playwright) pending; API image (build · smoke · Trivy) pending; Secret scan (gitleaks) pending; Static analysis (Semgrep) pending
- Migrations added: none
- Contract changes (packages/types): none
- New dependencies: none
- Invariants proven by property tests: none; implementation stopped before ledger changes
- Security-relevant changes: none; no RLS, grants, guards or tests changed
- Deviations from ADR 0008: none implemented; stopped under the explicit contract-blocker rule
- Known issues / TODO: `packages/types/src/api/fees.ts:75–76` retains the original 100,000,000-cent cap when chaining `.max(Number.MAX_SAFE_INTEGER)`. Verified against the installed schemas: `listInvoicesResponseSchema.shape.totals.safeParse({ totalCents: 500_000_000, paidCents: 0 }).success` is false. This is a valid total for 2,000 students at 250,000 cents and would produce HTTP 500 through response validation.
- Known issues / TODO: `invoiceListItemSchema.shape.totalCents.safeParse(120_000_000).success` is false, although two class fees of 60,000,000 cents are individually valid. ADR §1 requires one combined invoice per student/month. The contract owner must correct aggregate amount bounds using fresh schemas and add boundary tests before this track resumes; clamping amounts or limiting enrolments would violate the spec.
- Invoice job timing: not measured; invoice generation was not implemented
- Review these files first (max 10): `packages/types/src/api/fees.ts`, `packages/types/src/api/classes.ts`, `apps/api/src/common/validation/endpoint.interceptor.ts`, `docs/decisions/0008-fee-ledger.md`, `docs/plan/reports/p3-a-ledger.md`
