import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { createOwnerDb } from './client';

export const MIGRATIONS_DIR = fileURLToPath(new URL('../migrations', import.meta.url));

/**
 * Apply pending migrations (drizzle-kit output + hand-written security SQL, in journal order)
 * in one transaction. `ownerUrl` must connect as `remix_owner`, and the cluster roles must
 * already exist (0000_bootstrap checks). Run by CI/deploy — never by the app at boot.
 */
export async function runMigrations(ownerUrl: string): Promise<void> {
  const db = createOwnerDb(ownerUrl);
  try {
    await migrate(db, { migrationsFolder: MIGRATIONS_DIR });
  } finally {
    await db.$client.end();
  }
}
