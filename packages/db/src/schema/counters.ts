import { sql } from 'drizzle-orm';
import { bigint, check, pgTable, primaryKey, text } from 'drizzle-orm/pg-core';
import { tenantId, timestamps } from './columns';
import { tenants } from './tenants';

/**
 * Gap-free per-tenant counters for human numbers (ADR 0007): `student` (no period) for student
 * numbers, `receipt` per Asia/Colombo year. Allocate with `allocateNumbers()` inside withTenant —
 * the upsert holds a row lock until commit, so a rollback gives the numbers back. The key is
 * `(tenant_id, kind, period)`; nothing references a counter, so there is no `id`.
 */
export const tenantCounters = pgTable(
  'tenant_counters',
  {
    tenantId: tenantId().references(() => tenants.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    period: text('period').notNull().default(''),
    value: bigint('value', { mode: 'number' }).notNull(),
    ...timestamps(),
  },
  (t) => [
    primaryKey({ name: 'tenant_counters_pkey', columns: [t.tenantId, t.kind, t.period] }),
    check('tenant_counters_kind_format', sql`${t.kind} ~ '^[a-z][a-z_]{0,31}$'`),
    check('tenant_counters_period_length', sql`char_length(${t.period}) <= 16`),
    check('tenant_counters_value_non_negative', sql`${t.value} >= 0`),
  ],
);
