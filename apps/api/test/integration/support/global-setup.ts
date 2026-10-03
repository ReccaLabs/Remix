import { provisionTestDatabase } from '@remix/db/testing';
import type { TestProject } from 'vitest/node';

declare module 'vitest' {
  export interface ProvidedContext {
    dbUrls: { owner: string; app: string };
  }
}

/**
 * One migrated, uniquely named database per run on the shared local Postgres (the dev stack),
 * dropped afterwards; a Testcontainers Postgres when none is reachable. See
 * packages/db/src/testing.ts.
 */
export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  const database = await provisionTestDatabase();
  project.provide('dbUrls', { owner: database.urls.owner, app: database.urls.app });
  return () => database.teardown();
}
