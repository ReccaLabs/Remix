import { parseArgs } from 'node:util';
import { z } from 'zod';
import { createOwnerDb } from '../client';
import { creditSmsWallet, SmsWalletToolError } from '../sms-wallet';
import { fail, ownerUrl } from './env';

// pnpm --filter @remix/db tenant:sms-credit -- --slug kamalphysics --amount-lkr 2000 --note "Invoice INV-123 paid" [--request <id>]
// pnpm --filter @remix/db tenant:sms-credit -- --slug kamalphysics --sender-id KamalPhys [--threshold-lkr 200]

const USAGE =
  'Usage: tenant:sms-credit --slug <slug> [--amount-lkr <n> --note <text> [--request <id>]] [--sender-id <mask>|--sender-id default] [--threshold-lkr <n>]';

function parse() {
  return parseArgs({
    options: {
      slug: { type: 'string' },
      'amount-lkr': { type: 'string' },
      note: { type: 'string' },
      request: { type: 'string' },
      'sender-id': { type: 'string' },
      'threshold-lkr': { type: 'string' },
    },
    strict: true,
    allowPositionals: false,
  }).values;
}
let args: ReturnType<typeof parse>;
try {
  args = parse();
} catch {
  fail(USAGE);
}

/** "2000" or "2000.50" -> cents, exact (no floating point). */
function lkrToCents(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const m = /^(\d{1,9})(?:\.(\d{1,2}))?$/.exec(value);
  if (!m) fail(`Not an LKR amount: ${value}`);
  return Number(m[1]) * 100 + Number((m[2] ?? '').padEnd(2, '0'));
}

const db = createOwnerDb(ownerUrl());
try {
  const result = await creditSmsWallet(db, {
    slug: args.slug ?? '',
    amountCents: lkrToCents(args['amount-lkr']),
    note: args.note,
    requestId: args.request,
    senderId: args['sender-id'] === undefined ? undefined : args['sender-id'] === 'default' ? null : args['sender-id'],
    lowBalanceThresholdCents: lkrToCents(args['threshold-lkr']),
  });
  console.log(`SMS wallet of ${args.slug}: balance LKR ${(result.balanceCents / 100).toFixed(2)}, sender ${result.senderId ?? '(platform default)'}.`);
} catch (error) {
  if (error instanceof z.ZodError) {
    const lines = error.issues.map((i) => `  ${i.path.join('.') || 'input'}: ${i.message}`);
    fail(`Invalid input:\n${lines.join('\n')}\n${USAGE}`);
  }
  if (error instanceof SmsWalletToolError) fail(error.message);
  fail('Could not update the SMS wallet', error);
} finally {
  await db.$client.end();
}
