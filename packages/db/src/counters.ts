import { sql } from 'drizzle-orm';
import type { Tx } from './client';
import { tenantCounters } from './schema';

/** Counter kinds in use (ADR 0007). Both use the four-digit Colombo year as `period`. */
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
export function studentNumberFloor(
  prefix: string,
  year: number,
  numbers: readonly string[],
): number {
  let highest = 0;
  for (const number of numbers) {
    const start = `${prefix}-${String(year).slice(-2)}-`;
    if (!number.startsWith(start)) continue;
    const suffix = number.slice(start.length);
    if (!/^\d+$/.test(suffix)) continue;
    const value = Number(suffix);
    if (
      value >= 1 &&
      Number.isSafeInteger(value) &&
      formatStudentNo(prefix, year, value) === number
    ) {
      highest = Math.max(highest, value);
    }
  }
  return highest;
}

/** Joining year in Asia/Colombo, including the boundary before UTC midnight. */
export function studentJoiningYear(instant: Date): number {
  return Number(
    new Intl.DateTimeFormat('en', { timeZone: 'Asia/Colombo', year: 'numeric' }).format(instant),
  );
}

/** `formatStudentNo('NIL', 2026, 42)` → "NIL-26-0042"; padding never truncates. */
export function formatStudentNo(prefix: string, year: number, value: number): string {
  if (
    !/^[A-Z]{2,4}$/.test(prefix) ||
    !Number.isInteger(year) ||
    year < 1000 ||
    year > 9999 ||
    !Number.isSafeInteger(value) ||
    value < 1
  ) {
    throw new RangeError('Invalid student number prefix, year or sequence');
  }
  return `${prefix}-${String(year).slice(-2)}-${String(value).padStart(4, '0')}`;
}
