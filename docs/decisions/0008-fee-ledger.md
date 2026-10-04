# 0008 — Fee ledger: invoices, payments, allocations, derived status, reversals

- **Status:** Accepted · 2026-10-04
- **Settles:** the money core rules 1–9 in [02-features → FEE](../plan/02-features.md#business-rules--the-money-core-must-have-unit--integration-tests); tables in [03-architecture §5](../plan/03-architecture.md#5-domain-model-core-tables); [roadmap §6](../plan/05-roadmap.md#6-decision-backlog-adrs) item 0008. Builds on [0005](0005-tenancy-shared-schema-rls.md) (RLS), [0007](0007-ids-money-time-numbering.md) (cents, business dates, counters) and [0012](0012-background-jobs.md) (jobs).

## Context

Phase 3 lets institutes collect fees by card (PayHere), bank slip, cash and manual entry. A wrong answer to "is this month paid?" either locks out a paying student or gives away a class, and both destroy trust. Money must be reconstructable after the fact: who took what, for which month, and what changed later.

## Decision

### 1. Tables (all tenant-scoped, RLS forced, composite tenant FKs)

| Table | Role | Mutability |
| --- | --- | --- |
| `invoices` | One per *(student, month)*. Number `<PREFIX>-I-YY-MM-<studentNo>` (FEE-01). `due_on` = the tenant's due day of that month (default 5th). | Insert; `status` projection columns only |
| `invoice_lines` | One per *(enrolment, month)*: `amount_cents` snapshot of the effective fee (override or class fee) at generation. Unique `(tenant_id, enrollment_id, month)`. | Insert; `voided_at` + reason only (enrolment ended before the month) |
| `payments` | `method` ∈ `card · slip · cash · manual · reversal`, `amount_cents`, `received_by`, `provider_ref`, `idempotency_key` (unique per tenant), `reverses_payment_id`. | **Append-only** |
| `payment_allocations` | `(payment_id, invoice_line_id, amount_cents)`. | **Append-only** |
| `receipts` | One per non-reversal payment. Number `<PREFIX>-R-YY-NNNNN`, gap-free per tenant per year (0007 counters, same transaction). `reversed_at` set when its payment is reversed. | Insert; `reversed_at`, `pdf_key` only |
| `bank_slips` | Slip lifecycle (§5). | State columns only |
| `payhere_checkouts` | Order created for a card payment: lines + expected amount snapshot. | State columns only |
| `provider_events` | Raw inbound webhook/notify, unique `(provider, event_id)`. | Insert; `processed_at` only |

"Append-only" is enforced in the database: the app role (`remix_app`) has `INSERT, SELECT` on `payments` and `payment_allocations` and **no** `UPDATE`/`DELETE`; the isolation catalog test pins this.

### 2. Derived status — nobody sets "paid" by hand

- A line is **paid** when `sum(allocations.amount_cents) ≥ amount_cents`. A line with `amount_cents = 0` (free card) is paid. A voided line is neither paid nor owed.
- An invoice is `paid` when every non-voided line is paid, `partially_paid` when some are, `overdue` when unpaid and today (Asia/Colombo) > `due_on`, else `unpaid`. Invoice `status` and `paid_cents` columns are a **cached projection**, recomputed in the same transaction as any allocation change. A nightly job recomputes from the ledger and alerts on any mismatch.
- Allocations never exceed a line's open balance, and the sum of a payment's allocations never exceeds the payment amount (checked in the service inside the transaction, with the line rows locked `FOR UPDATE`; covered by property tests).

### 3. Unlock rule (FEE rule 2, J-05)

`canAccess(student, class, month)` is true iff the invoice line for *(the student's enrolment in that class, month)* exists, is not voided, and is paid. This is the single function the API calls before issuing lesson playback tokens, tute URLs or live-class joins (Phases 4–5). There is no grace period in R1. A tenant setting `unlockBeforeDue` is reserved, default `false`.

### 4. Writing payments — one path for every method

`recordPayment(tx, { method, amountCents, lines[], idempotencyKey, receivedBy, providerRef?, note? })`:

1. If a payment with this `idempotencyKey` exists → return it unchanged (no error, no second receipt).
2. Lock the target lines `FOR UPDATE`; compute open balances.
3. Insert the payment, then allocations: each line gets `min(open balance, remaining)`, oldest month first.
4. Any amount left after allocation (only possible for card, §6) stays **unallocated** on the payment and is flagged `needs_refund` for the owner. It is never auto-applied to other months in R1.
5. Recompute invoice projections, allocate the receipt number, write the receipt row, write an audit event, and enqueue receipt SMS/PDF jobs (after commit, keyed by payment id).

Cash and manual payments must exactly cover the selected lines' open balances (the counter computes change client-side; `cashReceivedCents` is stored on the receipt for printing only).

### 5. Bank slips (FEE-05/06, rules 3–4)

- States: `submitted → approved | rejected | superseded`. A new slip for the same lines supersedes a still-`submitted` one.
- Approve creates a `slip` payment for the **expected** open amount of the selected lines (idempotency key = `slip:<slipId>`). If the amount read from the slip differs, the cashier must either approve the selected lines only or reject; there are no partial approvals.
- Duplicate check: an approved slip in this tenant with the same normalised reference (upper-case, no spaces) **and** amount → flagged "Reference used before". Approval then requires an explicit `confirmDuplicate: true` and is audited.
- Reject requires a reason; the student is sent an SMS with it.

### 6. PayHere (FEE-04, rule 5)

- Checkout: the API creates a `payhere_checkouts` row (order id = row id, lines, amount, `LKR`) and returns the signed form fields; the hash uses the merchant secret server-side only. The browser redirect (`return_url`) is **never** trusted.
- Notify (`POST /api/v1/webhooks/payhere/:tenantSlug`): verify `md5sig = UPPER(MD5(merchant_id + order_id + payhere_amount + payhere_currency + status_code + UPPER(MD5(secret))))` with a constant-time compare; then require that the merchant id matches the tenant's, the order exists, the currency is `LKR` and the amount equals the checkout amount exactly. Store the raw event in `provider_events` (unique `payhere:<payment_id>`), answer `200` fast and process in the `payments` queue.
- Only `status_code = 2` creates a payment (idempotency key = `payhere:<payment_id>`). Other codes update the checkout state only.
- If a selected line was paid by another method in the meantime, the surplus stays unallocated with `needs_refund` (§4.4).

### 7. Reversal (FEE-11, rule 8)

Owner only, reason required. Inserts a `reversal` payment with `amount_cents = −original`, `reverses_payment_id`, and **negative allocations mirroring the original's allocations**. A payment can be reversed once (unique `reverses_payment_id`). Projections are recomputed, so the month re-locks if no longer paid. The original receipt gets `reversed_at`. Audited.

### 8. Invoice generation (FEE-01, rule 7)

- Monthly job on the `fees` queue, repeatable at 00:05 Asia/Colombo on the 1st, one job per tenant keyed `invoices:<tenant>:<YYYY-MM>`. It inserts lines with `ON CONFLICT DO NOTHING` on `(tenant_id, enrollment_id, month)`, so running it twice changes nothing.
- Enrolling a student (or moving them) generates the current month's line immediately through the same function. Pro-rata is off (R2 setting).
- Ending an enrolment before a month voids that month's unpaid line; a paid line is never voided (the owner reverses the payment first).

### 9. Integration secrets (SET-02)

PayHere merchant secrets live in `tenant_integrations.secret_ciphertext`: AES-256-GCM with a random 96-bit nonce per write and the tenant id as associated data, key from `INTEGRATIONS_KEY` (env, 32 bytes, base64) with a `key_id` column for rotation. The API never returns a secret: reads show `••••` + last 4. Changing it is audited.

## Consequences

- Correctness rests on three mechanical properties, each with tests: append-only grants (catalog test), idempotency keys (run-twice tests), and allocation bounds (property tests over random sequences of payments, reversals and voids: a line is never paid without allocations ≥ amount, and money is never created or lost).
- Refunds are manual in R1 (`needs_refund` list for owners); PayHere refund API and reconciliation (FEE-14) are R2.
- Partial payments are not offered to students in R1 (whole months only), which keeps the counter and slip flows simple.
