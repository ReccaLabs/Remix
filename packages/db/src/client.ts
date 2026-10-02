import { sql } from 'drizzle-orm';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema';

export type Schema = typeof schema;
export type Db = NodePgDatabase<Schema> & { $client: pg.Pool };
/** The transaction handle passed to `withTenant` / `db.transaction` callbacks. */
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
/** Anything that can run a query: the pool-backed db or an open transaction. */
export type Queryable = Db | Tx;

export interface DbOptions {
  /** Pool size (default 10). */
  max?: number;
  /** Shown in pg_stat_activity. */
  applicationName?: string;
}

/**
 * Pool-backed Drizzle client for the API and workers. `url` must connect as `remix_app` (RLS
 * enforced). Tenant data is only reachable inside `withTenant()`; outside it every tenant table
 * reads empty. Close with `db.$client.end()`.
 */
export function createDb(url: string, options: DbOptions = {}): Db {
  const pool = new pg.Pool({
    connectionString: url,
    max: options.max ?? 10,
    application_name: options.applicationName ?? 'remix-api',
  });
  return drizzle({ client: pool, schema });
}

/**
 * Client for migrations, seed and provisioning CLIs only — `url` connects as `remix_owner`,
 * which bypasses RLS. Never use it in a running app or worker (ADR 0005).
 */
export function createOwnerDb(url: string, options: DbOptions = {}): Db {
  return createDb(url, { max: 1, applicationName: 'remix-owner', ...options });
}

/**
 * Boot-time guard for the API: refuse to serve if the pool's role could bypass RLS (superuser,
 * BYPASSRLS) or owns tables (owners bypass non-forced RLS). Throws with a generic message.
 */
export async function verifyAppRole(db: Db): Promise<void> {
  const { rows } = await db.execute<{ unsafe: boolean }>(sql`
    select r.rolsuper or r.rolbypassrls or exists (
      select 1 from pg_catalog.pg_class c where c.relowner = r.oid
    ) as unsafe
    from pg_catalog.pg_roles r
    where r.rolname = current_user
  `);
  if (rows[0]?.unsafe !== false) {
    throw new Error('Database role is not RLS-bound: connect the app as remix_app');
  }
}
