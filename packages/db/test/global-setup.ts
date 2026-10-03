import type { TestProject } from 'vitest/node';
import { provisionTestDatabase, type TestDbUrls } from '../src/testing';

declare module 'vitest' {
  export interface ProvidedContext {
    dbUrls: TestDbUrls;
  }
}

/**
 * One migrated, uniquely named database per run on the shared local Postgres (the dev stack),
 * dropped afterwards; a Testcontainers Postgres when none is reachable. See src/testing.ts.
 */
export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  const database = await provisionTestDatabase();
  project.provide('dbUrls', database.urls);
  return () => database.teardown();
}
