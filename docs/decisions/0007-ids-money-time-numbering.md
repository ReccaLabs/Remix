# 0007 — IDs, money, time and human-readable numbers

- **Status:** Accepted · 2026-10-02
- **Settles:** the conventions line of [03-architecture §5](../plan/03-architecture.md#5-domain-model-core-tables); money rules 6 and 9 and the numbering formats of FEE-01, FEE-09 and STU-03 in [02-features](../plan/02-features.md); [roadmap §6](../plan/05-roadmap.md#6-decision-backlog-adrs) item 0007.

## Context

These choices land in every table and every API payload, and are close to impossible to change later. Money and receipt numbers are what institutes check by hand. Dates decide whether a student's month is paid and unlocked, at Sri Lanka midnight, not UTC midnight.

## Decision

### IDs: UUIDv7 from Postgres 18

- Every table's key is `id uuid primary key default uuidv7()`, using the function built into Postgres 18. Rows get ids from the database; code that needs the id uses `RETURNING`. We add no JavaScript UUID library until something genuinely needs ids before insert.
- **Why v7:**
  - time-ordered, so B-tree inserts stay at the right edge (less page splitting and WAL than random v4);
  - roughly creation-ordered, which helps cursor pagination;
  - globally unique, so tenants can move between cells without key clashes ([ADR 0005](0005-tenancy-shared-schema-rls.md)).
- **Not secrets.** A UUIDv7 reveals its creation time to the millisecond and carries about 62 random bits. That is far too many to enumerate, which helps against IDOR probing, but **RLS and API guards are the actual access control** (T1). Anything that grants access by possession uses 256-bit `crypto.randomBytes` values, never an id: session/device tokens, invite links, impersonation handoff codes, student card tokens.
- API payloads carry ids as strings validated with `z.uuid()`.

### Money: integer cents, LKR

- Database: `bigint` columns named `*_cents`, with `check (… >= 0)` where a negative value is impossible. Reversals are negative payments (FEE rule 8), so `payments.amount_cents` allows them. Never `numeric`, `real`/`double` or Postgres `money` (which depends on the locale).
- TypeScript: `Cents` from `@remix/types` (an integer `number`). Drizzle maps `bigint` with `mode: 'number'`. Safe integers reach about 9 × 10¹³ rupees, and Zod checks payload values with `.int()`. JSON fields end in `Cents` (`feeCents`).
- Arithmetic stays in integers. Never round intermediate values. When an amount is split across lines or months, use the largest-remainder method so the parts always add up to the whole. Shown with `formatLKR(cents, { exact: true })` in the app and on receipts.
- One currency (LKR), so there is no currency column. Adding a currency is a new ADR.
- Plan prices exist only in `packages/types/src/pricing.ts`. The `plans` table mirrors it and is never edited by hand.

### Time: UTC stored, Asia/Colombo for people and business dates

- An instant is `timestamptz`. The API's DB roles have `timezone = 'UTC'` and containers run with `TZ=UTC`, so nothing depends on a server's zone. JSON uses ISO 8601 with an offset (`z.iso.datetime({ offset: true })`); the API emits `Z`.
- **Business dates are calendar values in the tenant's zone:**
  - due dates and class-session dates: `date`;
  - billing months: `date` pinned to the 1st (`check (extract(day from month) = 1)`), `YYYY-MM` on the wire;
  - weekly class times: `time` wall-clock (`HH:MM`).

  "Today" and month boundaries are computed explicitly, as `(now() at time zone tenant.timezone)::date` or with `Intl` in TypeScript. They never come from `now()::date` or `new Date().getMonth()`.

- `tenants.timezone` holds the zone and is constrained to `Asia/Colombo` in R1, until another zone is tested. Use the IANA name, never a hard-coded `+05:30`. Display uses Asia/Colombo throughout.
- Scheduled jobs are expressed in Asia/Colombo (monthly invoices at 00:05 on the 1st). The scheduling mechanics belong to ADR 0012.

### Human numbers: per-tenant counters, allocated in the same transaction

```sql
create table tenant_counters (
  tenant_id uuid not null, kind text not null, period text not null default '',
  value bigint not null, primary key (tenant_id, kind, period));          -- RLS like any tenant table

insert into tenant_counters (tenant_id, kind, period, value) values (app_tenant_id(), $1, $2, $3)
on conflict (tenant_id, kind, period) do update set value = tenant_counters.value + excluded.value
returning value;                                                           -- $3 = how many to allocate
```

- The upsert takes a row lock until commit, so concurrent allocations in a tenant queue up and a rollback gives the number back. **The sequence is gap-free.** Postgres sequences are not (they're non-transactional and cached), and per-tenant sequences would mean DDL per tenant.
- **Receipts** (FEE-09, `<prefix>-R-YY-NNNNN`): `kind = 'receipt'`, `period` = the Asia/Colombo year of issue. Gap-free, as FEE rule 9 requires, because a missing receipt number must be explainable to an auditor. Receipts are never deleted; reversals annotate them (ADR 0008).
- **Student numbers** (STU rules, `<prefix>-1042`): `kind = 'student'`, never reused (archived students keep theirs). A CSV import allocates its whole block in one statement.
- **Invoice numbers** (FEE-01, `<prefix>-I-YY-MM-<studentNo>`) are composed from the student number and billing month, not counted. That is deterministic and still never derived from a UUID.
- `<prefix>` is the tenant's prefix (TEN-02). Every number column has `unique (tenant_id, number)`.
- Allocate the number as the last step before commit, so the lock is held briefly. At the planned 50 slip approvals per minute per cell, serialising per tenant is not a bottleneck.
- Numbers are for people: lookups within a tenant (cash counter, search) and printing. URLs, foreign keys and authorisation use UUIDs.

## Alternatives considered

- **Serial `bigint` ids.** Smaller and faster, but guessable and enumerable (IDOR probing), they leak volumes ("student 1,203"), and they collide when tenants move between cells.
- **UUIDv4.** Random inserts fragment indexes and lose time ordering. v7 has none of these drawbacks for us.
- **`numeric(12,2)` rupees.** Exact in Postgres, but it arrives in JavaScript as a string or float and invites float maths. Integer cents are exact everywhere.
- **Numbers derived from the UUID or a timestamp.** Not sequential, not human-friendly, and not gap-free.

## Consequences

- Reviewers reject floats in money paths, `now()::date`, and session-level time-zone assumptions. Pricing and money changes update `pricing.test.ts` and the money property tests.
- The FEE-01 invoice format assumes one invoice per student per month. ADR 0008 must keep that true (a mid-month enrolment adds lines to the open invoice) or switch invoices to a counter. Until then, `unique (tenant_id, number)` makes a collision fail loudly instead of producing a duplicate.

## Amendment - STU-07 and STU-06 (2026-10-05)

- New student numbers are `<PREFIX>-<YY>-<seq>`: the joining year in Asia/Colombo and a per-tenant `student` counter whose period is the four-digit year. Sequences restart at 1 each year, pad to at least four digits and grow without truncation. Existing students are never renumbered; imports keep supplied numbers, and only canonical numbers of the same year advance that year's counter.
- Prefixes contain 2-4 English capitals and are globally unique. Provisioning derives padded initials (Nilanka Institute: NIL) and tries deterministic alternatives on collision; the tenant-create CLI also accepts an explicit prefix, rejecting collisions.
- Card codes are stable student numbers plus a per-student card sequence (`NIL-26-0042-1`), not authentication tokens. Barcode, optional QR and optional NFC on one permanent card carry the same code. Codes and linked UIDs are never reused, even after revocation; access still requires tenant isolation and staff permissions.
- Student-number identity is unique per tenant after `upper(regexp_replace(student_no, '\s', '', 'g'))`; TypeScript uses the card contract's `normalizeCardInput`. Imports preserve display spelling and report collisions per row. The pre-launch unique-index migration fails on existing duplicates. Card codes use this normal form; numbers outside 3–60 visible ASCII characters cannot be printed on a card.
- PostgreSQL's POSIX whitespace class excludes non-breaking space, figure space, narrow non-breaking space and BOM. Imports reject these rather than introducing a different identity; issuance also requires the SQL and contract normal forms to agree. Existing display numbers remain unchanged.
