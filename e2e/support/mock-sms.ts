import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect } from '@playwright/test';
import { repoRoot } from './env';

/** Byte offset BEFORE an action: never reuse a code or link from an earlier delivery. */
export function smsOffset(): number {
  const file = resolve(repoRoot, 'e2e/mock-sms.log');
  return existsSync(file) ? readFileSync(file).length : 0;
}

/** How many mock SMS were delivered after the offset (the log also holds one line per API request). */
export function countSms(after: number): number {
  const file = resolve(repoRoot, 'e2e/mock-sms.log');
  if (!existsSync(file)) return 0;
  const text = readFileSync(file).subarray(after).toString('utf8');
  return text.split(/\r?\n/).filter((line) => line.includes('[mock sms]')).length;
}

export async function deliveredSms(phone: string, after: number, pattern: RegExp): Promise<string> {
  let found: string | undefined;
  await expect
    .poll(
      () => {
        const file = resolve(repoRoot, 'e2e/mock-sms.log');
        if (!existsSync(file)) return false;
        const text = readFileSync(file).subarray(after).toString('utf8');
        for (const line of text.split(/\r?\n/)) {
          if (!line.includes('[mock sms]') || !line.includes(`to=${phone}`)) continue;
          // Pino emits JSON in CI; plain Nest output is also supported.
          let message = line;
          try {
            message = (JSON.parse(line) as { msg?: string }).msg ?? line;
          } catch {
            /* plain log */
          }
          found = pattern.exec(message)?.[1];
          if (found) return true;
        }
        return false;
      },
      { message: 'Mock SMS delivery', timeout: 10_000 },
    )
    .toBe(true);
  if (!found) throw new Error('Mock SMS did not contain the expected code or invite link');
  return found;
}
