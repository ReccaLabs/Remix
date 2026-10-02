import { randomBytes } from 'node:crypto';
import { sql, type SQL } from 'drizzle-orm';
import { afterAll, expect, inject } from 'vitest';
import { createDb, createOwnerDb, type Db, type Queryable } from '../src/client';

/** Pools for each role, closed after the test file. */
export function connectAll() {
  const urls = inject('dbUrls');
  const pools = {
    owner: createOwnerDb(urls.owner, { max: 4 }),
    app: createDb(urls.app, { max: 4 }),
    readonly: createDb(urls.readonly, { max: 2 }),
    platform: createDb(urls.platform, { max: 2 }),
    superuser: createDb(urls.superuser, { max: 2 }),
  } satisfies Record<string, Db>;
  afterAll(async () => {
    await Promise.all(Object.values(pools).map((db) => db.$client.end()));
  });
  return pools;
}

/** Short lowercase tag so parallel test files never collide on slugs, hosts or phones. */
export function uniqueTag(): string {
  return randomBytes(4).toString('hex');
}

/** Rows of a raw query, typed loosely (catalog and generic table probes). */
export async function rows<T extends Record<string, unknown>>(db: Queryable, query: SQL) {
  const result = await db.execute<T>(query);
  return result.rows;
}

export async function count(db: Queryable, table: string): Promise<number> {
  const [row] = await rows<{ n: number }>(
    db,
    sql`select count(*)::int as n from ${sql.identifier(table)}`,
  );
  return row?.n ?? -1;
}

interface PgErrorLike {
  code?: string;
  message?: string;
  cause?: unknown;
}

/** Drizzle wraps driver errors ("Failed query: …"); find the Postgres error underneath. */
export function pgError(error: unknown): { code: string; message: string } | null {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current; depth++) {
    const candidate = current as PgErrorLike;
    if (typeof candidate.code === 'string' && /^[0-9A-Z]{5}$/.test(candidate.code)) {
      return { code: candidate.code, message: candidate.message ?? '' };
    }
    current = candidate.cause;
  }
  return null;
}

export const RLS_VIOLATION = /violates row-level security policy/;
export const PERMISSION_DENIED = /permission denied/;

/** Assert a promise rejects with a Postgres SQLSTATE (and optionally a message pattern). */
export async function expectPgError(
  promise: Promise<unknown>,
  code: string,
  message?: RegExp,
): Promise<void> {
  let caught: unknown;
  try {
    await promise;
  } catch (error) {
    caught = error;
  }
  expect(caught, `expected SQLSTATE ${code}, but the statement succeeded`).toBeDefined();
  const err = pgError(caught);
  expect(err, `expected a Postgres error, got: ${String(caught)}`).not.toBeNull();
  expect(err?.code).toBe(code);
  if (message) expect(err?.message).toMatch(message);
}

/** Thrown to roll back a transaction on purpose (positive controls that must not persist). */
export class Rollback extends Error {
  constructor() {
    super('rollback');
  }
}

export async function rolledBack(work: Promise<unknown>): Promise<void> {
  await expect(work).rejects.toBeInstanceOf(Rollback);
}
