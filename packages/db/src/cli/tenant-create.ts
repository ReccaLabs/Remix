import { parseArgs } from 'node:util';
import { z } from 'zod';
import { createOwnerDb } from '../client';
import { createTenant, createTenantInputSchema } from '../provision';
import { fail, ownerUrl } from './env';

// pnpm --filter @remix/db tenant:create -- --slug kamalphysics --name "Kamal Physics" \
//   --plan institute --owner-phone 0771234567 --owner-name "Kamal Jayasinghe" [--prefix BR]

const USAGE =
  'Usage: tenant:create --slug <slug> --name <name> --plan <lite|tutor|institute|enterprise> ' +
  '--owner-phone <07XXXXXXXX> --owner-name <name> [--prefix <LETTERS>]';

let args: ReturnType<typeof parse>;
function parse() {
  return parseArgs({
    options: {
      slug: { type: 'string' },
      name: { type: 'string' },
      plan: { type: 'string' },
      'owner-phone': { type: 'string' },
      'owner-name': { type: 'string' },
      prefix: { type: 'string' },
    },
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
  const input = createTenantInputSchema.parse({
    slug: args.slug,
    name: args.name,
    plan: args.plan,
    ownerPhone: args['owner-phone'],
    ownerName: args['owner-name'],
    studentNoPrefix: args.prefix,
  });
  const created = await createTenant(db, input);
  console.log(`Created tenant ${created.slug} (${created.tenantId}), status trial.`);
  console.log(`Owner user ${created.ownerUserId}. Temporary password (shown once, must be changed`);
  console.log(`at first login): ${created.temporaryPassword}`);
} catch (error) {
  if (error instanceof z.ZodError) {
    const lines = error.issues.map((i) => `  ${i.path.join('.') || 'input'}: ${i.message}`);
    fail(`Invalid input:\n${lines.join('\n')}\n${USAGE}`);
  }
  const code = (error as { cause?: { code?: string } }).cause?.code;
  fail(code === '23505' ? 'That slug or explicit student prefix is already taken.' : 'Could not create the tenant', error);
} finally {
  await db.$client.end();
}
