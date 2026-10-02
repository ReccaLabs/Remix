import { AsyncLocalStorage } from 'node:async_hooks';
import { sql } from 'drizzle-orm';
import type { PgTransactionConfig } from 'drizzle-orm/pg-core';
import { z } from 'zod';
import type { Queryable, Tx } from './client';

const tenantIdSchema = z.uuid();

/** Tenant of the enclosing withTenant() call, to refuse nesting with a different tenant. */
const activeTenant = new AsyncLocalStorage<string>();

/**
 * Run `fn` in a transaction scoped to one tenant (ADR 0005). Sets `app.tenant_id` with
 * `set_config(…, true)` — transaction-local, so it can never leak to the next user of a pooled
 * connection — and RLS then limits every tenant table to that tenant's rows.
 *
 * Use the `tx` passed to `fn` for every query: the outer `db` has no tenant context and reads
 * empty. Throws on a non-UUID id (before touching the database) and when nested inside
 * withTenant for a different tenant.
 */
export async function withTenant<T>(
  db: Queryable,
  tenantId: string,
  fn: (tx: Tx) => Promise<T>,
  config?: PgTransactionConfig,
): Promise<T> {
  if (!tenantIdSchema.safeParse(tenantId).success) {
    throw new TypeError('withTenant: tenantId must be a UUID');
  }
  const outer = activeTenant.getStore();
  if (outer !== undefined && outer !== tenantId) {
    throw new Error('withTenant: already inside a different tenant context');
  }
  return activeTenant.run(tenantId, () =>
    db.transaction(async (tx) => {
      await tx.execute(sql`select pg_catalog.set_config('app.tenant_id', ${tenantId}, true)`);
      return fn(tx);
    }, config),
  );
}
