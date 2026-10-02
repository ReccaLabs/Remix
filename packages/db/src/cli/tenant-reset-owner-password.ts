import { parseArgs } from 'node:util';
import { z } from 'zod';
import { createOwnerDb } from '../client';
import { OwnerResetError, resetOwnerPassword } from '../provision';
import { fail, ownerUrl } from './env';

// pnpm --filter @remix/db tenant:reset-owner-password -- --slug kamalphysics [--owner-phone 0771234567]

const USAGE = 'Usage: tenant:reset-owner-password --slug <slug> [--owner-phone <07XXXXXXXX>]';

let args: ReturnType<typeof parse>;
function parse() {
  return parseArgs({
    options: { slug: { type: 'string' }, 'owner-phone': { type: 'string' } },
    strict: true,
    allowPositionals: false,
  }).values;
}
try {
  args = parse();
} catch {
  fail(USAGE);
}

const db = createOwnerDb(ownerUrl());
try {
  const reset = await resetOwnerPassword(db, {
    slug: args.slug ?? '',
    ownerPhone: args['owner-phone'],
  });
  console.log(`Reset the owner password of ${reset.slug} (owner user ${reset.ownerUserId}).`);
  console.log(`Revoked ${reset.revokedSessions} active session(s). New temporary password (shown`);
  console.log(`once, must be changed at first login): ${reset.temporaryPassword}`);
} catch (error) {
  if (error instanceof z.ZodError) {
    const lines = error.issues.map((i) => `  ${i.path.join('.') || 'input'}: ${i.message}`);
    fail(`Invalid input:\n${lines.join('\n')}\n${USAGE}`);
  }
  if (error instanceof OwnerResetError) fail(error.message);
  fail('Could not reset the owner password', error);
} finally {
  await db.$client.end();
}
