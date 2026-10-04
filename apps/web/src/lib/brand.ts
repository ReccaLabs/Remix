import { brandColorSchema } from '@remix/types/api';
import type { CSSProperties } from 'react';

/**
 * Tenant theming (TEN-03, DESIGN.md §2.2): an institute overrides only the brand tokens. The
 * value comes from the API, but it is re-validated here before it is ever written into a CSS
 * declaration, so a bad or hostile value (`red;}body{…`) can't escape the variable.
 */

type BrandVars = Record<
  '--color-brand' | '--color-brand-hover' | '--color-brand-soft' | '--color-brand-line',
  string
>;

function parseHex(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function toHex(rgb: readonly number[]): string {
  return `#${rgb.map((c) => Math.round(c).toString(16).padStart(2, '0')).join('')}`;
}

/** Linear mix of `hex` towards `target` (0–255 per channel) by `amount` (0–1). */
function mix(hex: string, target: number, amount: number): string {
  return toHex(parseHex(hex).map((c) => c + (target - c) * amount));
}

/** CSS variables for a tenant brand colour, or `undefined` (ReMix defaults) if it's invalid. */
export function brandCssVars(color: unknown): BrandVars | undefined {
  const parsed = brandColorSchema.safeParse(color);
  if (!parsed.success) return undefined;
  const brand = parsed.data.toLowerCase();
  return {
    '--color-brand': brand,
    // Same relationships as the default tokens: hover ≈ 9% darker, soft ≈ 93% towards white.
    '--color-brand-hover': mix(brand, 0, 0.09),
    '--color-brand-soft': mix(brand, 255, 0.93),
    // Borders on soft surfaces (default #c9d1f5 is about 75% of the way to white).
    '--color-brand-line': mix(brand, 255, 0.75),
  };
}

/** `style` prop for <html>; `undefined` keeps the ReMix theme. */
export function brandStyle(color: unknown): CSSProperties | undefined {
  return brandCssVars(color) as CSSProperties | undefined;
}
