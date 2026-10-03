import { cn } from '@remix/ui';
import type { ComponentPropsWithRef } from 'react';

/**
 * Native <select> in the same frame as the UI kit's inputs (44 px, 16 px text, line-strong
 * border). Native keeps the OS picker on phones. Works inside <Field> (it injects id and aria).
 */
export function Select({
  className,
  invalid,
  'aria-invalid': ariaInvalid,
  ...props
}: ComponentPropsWithRef<'select'> & { invalid?: boolean }) {
  const bad = invalid ?? (ariaInvalid === true || ariaInvalid === 'true');
  return (
    <select
      aria-invalid={bad || undefined}
      className={cn(
        'bg-surface text-ink block h-11 w-full min-w-0 rounded-md border px-3 text-base transition-colors duration-150',
        'hover:border-ink-2 focus:border-brand disabled:bg-canvas disabled:cursor-not-allowed disabled:opacity-70',
        bad ? 'border-danger hover:border-danger' : 'border-line-strong',
        className,
      )}
      {...props}
    />
  );
}
