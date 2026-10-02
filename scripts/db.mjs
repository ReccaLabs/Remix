// pnpm db:migrate / pnpm db:seed — forward to @remix/db with the dev stack's owner URL as the
// default, so no packages/db/.env is needed. An existing DATABASE_OWNER_URL (environment or
// packages/db/.env) wins. The seed itself refuses non-local hosts.
import { devDatabaseUrls, fail, must, run } from './lib.mjs';

const [command, ...rest] = process.argv.slice(2);
if (command !== 'migrate' && command !== 'seed') fail('Usage: node scripts/db.mjs <migrate|seed>');

const env = process.env.DATABASE_OWNER_URL ? {} : { DATABASE_OWNER_URL: devDatabaseUrls().owner };
await must(
  run('pnpm', ['--filter', '@remix/db', command, ...rest], { env }),
  `db:${command} failed. Is the stack up? Run: pnpm dev:stack`,
);
