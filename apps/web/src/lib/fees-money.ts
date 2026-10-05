import type { Cents } from '@remix/types/money';

/** Parse decimal rupees without floating-point multiplication or silent rounding. */
export function cashCents(value: string): Cents | null {
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(value.trim());
  if (!match) return null;
  const cents = Number(match[1]) * 100 + Number((match[2] ?? '').padEnd(2, '0'));
  return Number.isSafeInteger(cents) ? cents : null;
}
