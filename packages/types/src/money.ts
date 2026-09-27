/**
 * Money is always stored as integer cents (LKR × 100) — never floats.
 * Format for display with `formatLKR`.
 */
export type Cents = number;

export const lkr = (rupees: number): Cents => Math.round(rupees * 100);

const whole = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
const exact = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/**
 * `formatLKR(250000)` → "LKR 2,500" (marketing)
 * `formatLKR(250000, { exact: true })` → "LKR 2,500.00" (app, receipts, tables)
 */
export function formatLKR(cents: Cents, opts: { exact?: boolean } = {}): string {
  const rupees = cents / 100;
  return `LKR ${opts.exact ? exact.format(rupees) : whole.format(Math.round(rupees))}`;
}
