import { runMigrations } from '../migrate';
import { fail, ownerUrl } from './env';

// pnpm --filter @remix/db migrate — run by CI/deploy as remix_owner, never by the app at boot.
try {
  await runMigrations(ownerUrl());
  console.log('Migrations applied.');
} catch (error) {
  fail('Migration failed', error);
}
