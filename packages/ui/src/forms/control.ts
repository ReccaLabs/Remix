import type { AriaAttributes } from 'react';
import { cn } from '../cn';

/**
 * Shared look of text controls (Input, PasswordInput, PhoneInput).
 *
 * - Sizes: `md` 44 px (admin, staff login) · `lg` 52 px (student portal on phones, 48 px from md up).
 * - 16 px text so iOS/Android never zoom on focus.
 * - Border `line-strong` keeps ≥ 3:1 against white (WCAG 1.4.11); invalid = danger border + the
 *   error text from <Field>, never colour alone.
 */
export type ControlSize = 'md' | 'lg';

const sizes: Record<ControlSize, string> = {
  md: 'h-11 rounded-md',
  lg: 'h-13 rounded-xl md:h-12 md:rounded-md',
};

export function controlFrameClass({
  size = 'md',
  invalid,
  className,
}: {
  size?: ControlSize;
  invalid?: boolean;
  className?: string;
}) {
  return cn(
    'bg-surface text-ink block w-full min-w-0 border text-base transition-colors duration-150',
    'placeholder:text-muted hover:border-ink-2 focus:border-brand',
    'disabled:bg-canvas disabled:cursor-not-allowed disabled:opacity-70',
    invalid ? 'border-danger hover:border-danger' : 'border-line-strong',
    sizes[size],
    className,
  );
}

/** Group frame (affix or trailing button): the focus ring wraps the whole control. */
export function controlGroupClass(opts: {
  size?: ControlSize;
  invalid?: boolean;
  className?: string;
}) {
  return cn(
    controlFrameClass(opts),
    'flex items-stretch overflow-hidden',
    'focus-within:border-brand focus-within:outline-brand focus-within:outline-2 focus-within:outline-offset-2',
  );
}

/** The bare <input> inside a group frame. */
export const groupInputClass =
  'text-ink placeholder:text-muted h-full min-w-0 flex-1 border-0 bg-transparent px-3 text-base outline-none focus-visible:outline-none disabled:cursor-not-allowed';

/** `aria-invalid` drives the invalid style, so <Field> only has to set one attribute. */
export function isInvalid(value: AriaAttributes['aria-invalid']) {
  return value === true || value === 'true' || value === 'grammar' || value === 'spelling';
}

/** Joins id lists for aria-describedby, dropping blanks. */
export function joinIds(...ids: Array<string | false | null | undefined>) {
  const list = ids.flatMap((id) => (id ? id.split(/\s+/) : [])).filter(Boolean);
  return list.length > 0 ? Array.from(new Set(list)).join(' ') : undefined;
}
