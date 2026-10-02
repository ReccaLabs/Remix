import { existsSync } from 'node:fs';

/**
 * CLI configuration. Loads `packages/db/.env` when present (git-ignored; see .env.example) —
 * real environment variables win. Only the CLIs read env; library code takes URLs as arguments.
 */
if (existsSync('.env')) process.loadEnvFile('.env');

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`${name} is not set (see packages/db/.env.example).`);
    process.exit(1);
  }
  return value;
}

/** The owner connection: migrations, seed and provisioning only — never the running app. */
export const ownerUrl = () => requireEnv('DATABASE_OWNER_URL');

/** Report a failure without a stack trace or connection details. */
export function fail(message: string, error?: unknown): never {
  const code = (error as { code?: unknown; cause?: { code?: unknown } } | undefined)?.code;
  const causeCode = (error as { cause?: { code?: unknown } } | undefined)?.cause?.code;
  const sqlstate = typeof code === 'string' ? code : typeof causeCode === 'string' ? causeCode : '';
  console.error(sqlstate ? `${message} (SQLSTATE ${sqlstate})` : message);
  if (process.env.DEBUG && error instanceof Error) console.error(error.message);
  process.exit(1);
}
