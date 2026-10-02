import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import pg from 'pg';
import type { TestProject } from 'vitest/node';
import { runMigrations } from '../src/migrate';

/** Same image family as infra/docker/compose.yaml. */
const IMAGE = 'postgres:18-alpine';
const DATABASE = 'remix';
const SUPERUSER_PASSWORD = 'test-only-superuser';

/**
 * Cluster roles as production expects them (README → "Production roles"). Ephemeral container
 * bound to a random local port, so fixed test-only passwords are fine here. Kept as literal
 * statements (no interpolation) — keep BOOTSTRAP and ROLE_PASSWORDS in sync.
 */
const ROLE_PASSWORDS = {
  remix_owner: 'test-only-owner',
  remix_app: 'test-only-app',
  remix_platform: 'test-only-platform',
  remix_readonly: 'test-only-readonly',
} as const;

const BOOTSTRAP = [
  "CREATE ROLE remix_owner LOGIN PASSWORD 'test-only-owner' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOINHERIT",
  "CREATE ROLE remix_app LOGIN PASSWORD 'test-only-app' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOINHERIT",
  "CREATE ROLE remix_platform LOGIN PASSWORD 'test-only-platform' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOINHERIT",
  "CREATE ROLE remix_readonly LOGIN PASSWORD 'test-only-readonly' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOINHERIT",
  "ALTER ROLE remix_owner SET timezone = 'UTC'",
  "ALTER ROLE remix_app SET timezone = 'UTC'",
  "ALTER ROLE remix_platform SET timezone = 'UTC'",
  "ALTER ROLE remix_readonly SET timezone = 'UTC'",
  'CREATE DATABASE remix OWNER remix_owner',
];

declare module 'vitest' {
  export interface ProvidedContext {
    dbUrls: {
      superuser: string;
      owner: string;
      app: string;
      platform: string;
      readonly: string;
    };
  }
}

let container: StartedPostgreSqlContainer | undefined;

export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  container = await new PostgreSqlContainer(IMAGE)
    .withDatabase('postgres')
    .withUsername('postgres')
    .withPassword(SUPERUSER_PASSWORD)
    .start();

  const host = container.getHost();
  const port = container.getPort();
  const url = (user: string, password: string, database = DATABASE) =>
    `postgres://${user}:${password}@${host}:${port}/${database}`;

  const superuser = new pg.Client({
    connectionString: url('postgres', SUPERUSER_PASSWORD, 'postgres'),
  });
  await superuser.connect();
  try {
    for (const statement of BOOTSTRAP) await superuser.query(statement);
  } finally {
    await superuser.end();
  }

  const owner = url('remix_owner', ROLE_PASSWORDS.remix_owner);
  await runMigrations(owner);

  project.provide('dbUrls', {
    superuser: url('postgres', SUPERUSER_PASSWORD),
    owner,
    app: url('remix_app', ROLE_PASSWORDS.remix_app),
    platform: url('remix_platform', ROLE_PASSWORDS.remix_platform),
    readonly: url('remix_readonly', ROLE_PASSWORDS.remix_readonly),
  });

  return async () => {
    await container?.stop();
  };
}
