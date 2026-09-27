import { cn } from './cn';

/**
 * Button styles as a class helper so they apply equally to <button>, <a> and framework <Link>.
 * Sizes follow the design: md 40px (header), lg 48px (hero), xl 52px (final CTA).
 * All sizes keep a ≥44px touch target on mobile except `md`, which is only used in the desktop header.
 */
export type ButtonVariant = 'primary' | 'outline' | 'ghost' | 'dark' | 'success';
export type ButtonSize = 'sm' | 'md' | 'lg' | 'xl';

const base =
  'inline-flex items-center justify-center gap-2 rounded-md font-semibold whitespace-nowrap no-underline transition-colors duration-150 hover:no-underline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:pointer-events-none disabled:opacity-50';

const variants: Record<ButtonVariant, string> = {
  primary: 'bg-brand text-white hover:bg-brand-hover hover:text-white',
  outline: 'border border-ink text-ink hover:bg-paper-2 hover:text-ink',
  ghost: 'text-ink hover:bg-paper-2 hover:text-ink',
  dark: 'bg-ink text-white hover:bg-ink-2 hover:text-white',
  success: 'bg-success text-white hover:bg-success-ink hover:text-white',
};

const sizes: Record<ButtonSize, string> = {
  sm: 'h-9 px-3 text-sm',
  md: 'h-10 px-4 text-[15px]',
  lg: 'h-12 px-[22px] text-base',
  xl: 'h-[52px] px-6 text-base',
};

export function buttonClass(
  opts: { variant?: ButtonVariant; size?: ButtonSize; className?: string } = {},
) {
  const { variant = 'primary', size = 'lg', className } = opts;
  return cn(base, variants[variant], sizes[size], className);
}
