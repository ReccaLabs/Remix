import { cn } from '@remix/ui';
import { AlertCircle, ChevronDown } from 'lucide-react';
import type { ComponentPropsWithRef, ReactNode } from 'react';

/**
 * Form primitives for remix.lk (and the pattern the product forms will reuse).
 *
 * - 44 px minimum targets, 16 px text (no iOS zoom on focus), token colours only.
 * - Focus: the global :focus-visible ring (theme.css) plus a brand border.
 * - Errors: pass `invalid` + `aria-describedby` pointing at a <FieldError id>. Errors are
 *   always an icon + words, never colour alone.
 * - Borders use muted/70 so the field edge keeps ≥ 3:1 contrast on white (WCAG 1.4.11).
 */

const control =
  'block w-full min-w-0 rounded-xs border bg-surface text-base text-ink transition-colors duration-150 ' +
  'placeholder:text-muted hover:border-ink-2 focus:border-brand disabled:cursor-not-allowed disabled:opacity-60';

export function controlClass(invalid?: boolean, className?: string) {
  return cn(
    control,
    invalid ? 'border-danger hover:border-danger' : 'border-line-strong',
    className,
  );
}

export function Field({ className, ...props }: ComponentPropsWithRef<'div'>) {
  return <div className={cn('flex flex-col gap-1.5', className)} {...props} />;
}

export function Label({
  optional,
  className,
  children,
  ...props
}: ComponentPropsWithRef<'label'> & { /** Localised "(optional)" text. */ optional?: string }) {
  return (
    <label className={cn('text-ink text-sm font-medium', className)} {...props}>
      {children}
      {optional ? <span className="text-muted font-normal"> ({optional})</span> : null}
    </label>
  );
}

export function FieldHint({ className, ...props }: ComponentPropsWithRef<'p'>) {
  return <p className={cn('text-muted m-0 text-[13px] leading-5', className)} {...props} />;
}

/** Inline field error. Give it an id and reference it from the control's aria-describedby. */
export function FieldError({ className, children, ...props }: ComponentPropsWithRef<'p'>) {
  return (
    <p
      className={cn('text-danger-ink m-0 flex items-start gap-1.5 text-sm font-medium', className)}
      {...props}
    >
      <AlertCircle size={16} aria-hidden className="mt-0.5 flex-none" />
      <span>{children}</span>
    </p>
  );
}

type InvalidProp = { invalid?: boolean };

export function Input({
  invalid,
  className,
  ...props
}: ComponentPropsWithRef<'input'> & InvalidProp) {
  return (
    <input
      aria-invalid={invalid || undefined}
      className={controlClass(invalid, cn('h-11 px-3', className))}
      {...props}
    />
  );
}

/**
 * Text input with a fixed prefix/suffix box (e.g. "+94", ".remix.lk"). The affix is visual only
 * (aria-hidden) — say it in the label or hint too. The ring wraps the whole group.
 */
export function AffixInput({
  invalid,
  prefix,
  suffix,
  className,
  ...props
}: Omit<ComponentPropsWithRef<'input'>, 'prefix'> &
  InvalidProp & { prefix?: ReactNode; suffix?: ReactNode }) {
  const affix =
    'bg-canvas text-ink-2 tabular flex flex-none items-center px-3 font-medium select-none';
  return (
    <div
      className={cn(
        controlClass(invalid, 'flex h-11 overflow-hidden'),
        'focus-within:border-brand focus-within:outline-brand focus-within:outline-2 focus-within:outline-offset-2',
        className,
      )}
    >
      {prefix ? (
        <span
          aria-hidden
          className={cn(affix, 'border-r', invalid ? 'border-danger' : 'border-line-strong')}
        >
          {prefix}
        </span>
      ) : null}
      <input
        aria-invalid={invalid || undefined}
        className="text-ink placeholder:text-muted h-full min-w-0 flex-1 border-0 bg-transparent px-3 text-base outline-none focus-visible:outline-none"
        {...props}
      />
      {suffix ? (
        <span
          aria-hidden
          className={cn(affix, 'border-l', invalid ? 'border-danger' : 'border-line-strong')}
        >
          {suffix}
        </span>
      ) : null}
    </div>
  );
}

export function Textarea({
  invalid,
  className,
  ...props
}: ComponentPropsWithRef<'textarea'> & InvalidProp) {
  return (
    <textarea
      aria-invalid={invalid || undefined}
      className={controlClass(invalid, cn('min-h-28 resize-y px-3 py-2.5 leading-6', className))}
      {...props}
    />
  );
}

/** Native <select> (best on cheap phones and screen readers) with our chevron. */
export function Select({
  invalid,
  className,
  children,
  ...props
}: ComponentPropsWithRef<'select'> & InvalidProp) {
  return (
    <div className="relative">
      <select
        aria-invalid={invalid || undefined}
        className={controlClass(
          invalid,
          cn('h-11 cursor-pointer appearance-none pl-3 pr-10', className),
        )}
        {...props}
      >
        {children}
      </select>
      <ChevronDown
        size={18}
        aria-hidden
        className="text-muted pointer-events-none absolute right-3 top-1/2 -translate-y-1/2"
      />
    </div>
  );
}

/** Native checkbox inside a ≥ 44 px label row; accent-color keeps it on-brand. */
export function Checkbox({
  label,
  className,
  ...props
}: Omit<ComponentPropsWithRef<'input'>, 'type'> & { label: ReactNode }) {
  return (
    <label
      className={cn(
        'text-ink flex min-h-11 cursor-pointer items-center gap-3 text-[15px]',
        className,
      )}
    >
      <input type="checkbox" className="accent-brand size-5 flex-none cursor-pointer" {...props} />
      <span>{label}</span>
    </label>
  );
}
