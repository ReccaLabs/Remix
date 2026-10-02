import { useId, type ComponentPropsWithRef, type ReactNode } from 'react';
import { cn } from '../cn';
import { joinIds } from './control';

export interface CheckboxProps extends Omit<ComponentPropsWithRef<'input'>, 'type'> {
  /** Visible label (localised). Clicking it toggles the box. */
  label: ReactNode;
  /** Extra line under the label, wired with aria-describedby. */
  hint?: ReactNode;
}

/**
 * Native checkbox (best for screen readers and cheap phones) inside a ≥ 44 px label row.
 * `accent-color` keeps it on the tenant brand colour.
 */
export function Checkbox({
  label,
  hint,
  id,
  className,
  'aria-describedby': describedBy,
  ...props
}: CheckboxProps) {
  const generated = useId();
  const inputId = id ?? `checkbox-${generated}`;
  const hintId = hint ? `${inputId}-hint` : undefined;

  return (
    <div className={cn('flex flex-col', className)}>
      <label
        htmlFor={inputId}
        className="text-ink has-disabled:cursor-not-allowed has-disabled:opacity-60 flex min-h-11 cursor-pointer items-center gap-3 text-[15px]"
      >
        <input
          id={inputId}
          type="checkbox"
          aria-describedby={joinIds(hintId, describedBy)}
          className="accent-brand size-5 flex-none cursor-pointer disabled:cursor-not-allowed"
          {...props}
        />
        <span>{label}</span>
      </label>
      {hint ? (
        <p id={hintId} className="text-muted m-0 -mt-1.5 pl-8 text-[13px] leading-5">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
