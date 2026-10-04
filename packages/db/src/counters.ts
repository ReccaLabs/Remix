import { sql } from 'drizzle-orm';
import type { Tx } from './client';
import { tenantCounters } from './schema';

/** Counter kinds in use (ADR 0007). `period` is '' for `student`, the Colombo year for `receipt`. */
export type CounterKind = 'student' | 'receipt';

export interface NumberBlock {
  first: number;
  last: number;
}

/** Largest block one call may take (a CSV import of a whole institute fits comfortably). */
export const MAX_NUMBER_BLOCK = 100_000;

/**
 * Allocate `count` consecutive numbers from the current tenant's counter (ADR 0007). Must run
 * inside withTenant: the row is keyed by `app_tenant_id()` and the upsert's row lock is held
 * until commit, so concurrent allocations queue and a rollback returns the numbers (gap-free).
 * Call it as the last step before commit to keep the lock short.
 */
export async function allocateNumbers(
  tx: Tx,
  kind: CounterKind,
  count = 1,
  period = '',
): Promise<NumberBlock> {
  if (!Number.isInteger(count) || count < 1 || count > MAX_NUMBER_BLOCK) {
    throw new RangeError(`allocateNumbers: count must be an integer 1–${MAX_NUMBER_BLOCK}`);
  }
  const [row] = await tx
    .insert(tenantCounters)
    .values({ tenantId: sql`public.app_tenant_id()`, kind, period, value: count })
    .onConflictDoUpdate({
      target: [tenantCounters.tenantId, tenantCounters.kind, tenantCounters.period],
      set: { value: sql`${tenantCounters.value} + excluded.value` },
    })
    .returning({ value: tenantCounters.value });
  if (row === undefined) throw new Error('allocateNumbers: no counter row returned');
  return { first: row.value - count + 1, last: row.value };
}

/** Advance a counter without moving it backwards; also locks it until transaction commit. */
export async function advanceCounter(
  tx: Tx,
  kind: CounterKind,
  minimum: number,
  period = '',
): Promise<void> {
  if (!Number.isSafeInteger(minimum) || minimum < 0) {
    throw new RangeError('advanceCounter: minimum must be a non-negative safe integer');
  }
  await tx
    .insert(tenantCounters)
    .values({ tenantId: sql`public.app_tenant_id()`, kind, period, value: minimum })
    .onConflictDoUpdate({
      target: [tenantCounters.tenantId, tenantCounters.kind, tenantCounters.period],
      set: { value: sql`greatest(${tenantCounters.value}, excluded.value)` },
    });
}

/** Only canonical generated numbers reserve a counter position; arbitrary legacy IDs do not. */
export function studentNumberFloor(prefix: string, numbers: readonly string[]): number {
  let highest = 0;
  for (const number of numbers) {
    if (!number.startsWith(`${prefix}-`)) continue;
    const suffix = number.slice(prefix.length + 1);
    if (!/^\d+$/.test(suffix)) continue;
    const value = Number(suffix);
    if (Number.isSafeInteger(value) && formatStudentNo(prefix, value) === number) {
      highest = Math.max(highest, value);
    }
  }
  return highest;
}

/** `formatStudentNo('BR', 1042)` → "BR-1042"; numbers are zero-padded to at least 4 digits. */
export function formatStudentNo(prefix: string, value: number): string {
  return `${prefix}-${String(value).padStart(4, '0')}`;
}
