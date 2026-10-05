# Phase 3 — execution board (Money)

> Part of the [ReMix development plan](README.md). Scope and exit criteria: [05-roadmap.md → Phase 3](05-roadmap.md#phase-3--money-weeks-811). Money rules: [ADR 0008](../decisions/0008-fee-ledger.md); uploads: [ADR 0009](../decisions/0009-file-storage.md).

## Scope

FEE-01…12 · SET-02/03 · MSG-01/02/04 · student Pay screens · admin Fees tabs · receipts (PDF + 80 mm). Deferred: FEE-13 OCR (R1s), FEE-14 reconciliation (R2).

## How this phase is built

Codex (`gpt-6.1-sol`) writes each track in its own worktree; Claude (lead) writes the contracts and ADRs, reviews every PR, and reviews money/security code line by line before merge. One track runs at a time. Each track ends with a report in `docs/plan/reports/p3-<track>.md` (fixed format) and a PR with all 6 CI checks green.

| # | Track | Writer · effort | Review | Delivers |
| --- | --- | --- | --- | --- |
| 3-0 | Contracts + ADRs | Claude (lead) | owner | ADR 0008, 0009; `packages/types/src/api/fees.ts`; endpoints; money permissions |
| 3-A | Ledger core | Codex · high | Opus line by line | invoices/lines/payments/allocations/receipts tables, append-only grants, `recordPayment`, projections, unlock function, reversal, monthly invoice job, property tests (FEE-01, FEE-11) |
| 3-B | Settings + receipts | Codex · high | Opus (secrets) | SET-02 encrypted merchant secret, SET-03 bank details, fee settings, receipt data + PDF + 80 mm layout (FEE-09) |
| 3-C | Cash + manual | Codex · medium | Opus (money paths) | FEE-07 cash counter, FEE-08 manual payment, student fees view, FEE-10 history |
| 3-D | Slips | Codex · high | Opus (uploads) | storage provider (ADR 0009), media worker, FEE-05 upload, FEE-06 queue with A/R/S |
| 3-E | PayHere | Codex · high | Opus line by line | FEE-03 Pay screen, FEE-04 checkout + notify webhook, test payment |
| 3-F | SMS | Codex · medium | report + CI | MSG-01 Text.lk adapter, MSG-02 wallet, MSG-04 templates, FEE-12 reminders, FEE-02 invoices tab + reminder send |
| 3-G | Fees UI + journeys | Codex · medium (Astra trial) | report + CI | admin Fees tabs polish, J-02, J-03, J-04, J-05, J-09 on local staging |
| 3-S | Security review | Claude Opus | — | PayHere notify, slips, ledger, secrets (two-reviewer rule) |

## Exit criteria (from the roadmap)

- [ ] J-02, J-03, J-04, J-05, J-09 green (PayHere **sandbox**, mock/Text.lk test SMS)
- [ ] Ledger property tests: random payments/reversals never produce a paid line without allocations ≥ amount
- [ ] Monthly invoice job idempotent (run twice → no duplicates); 50 tenants < 5 min
- [ ] Cashier: ≥ 3 slips/minute keyboard-only; cash counter < 30 s per student
- [ ] Two-reviewer security review of PayHere notify + slip flows

## Status

| Track | Status |
| --- | --- |
| 3-0 Contracts + ADRs | merged #43 |
| 3-A Ledger | merged #44 |
| 3-B Settings + receipts | merged #52 |
| 3-C Cash + manual | PR open |
| 3-D ... 3-G | waiting |
| 3-S | waiting |
