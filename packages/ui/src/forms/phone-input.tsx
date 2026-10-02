import { useId } from 'react';
import { cn } from '../cn';
import { controlGroupClass, groupInputClass, isInvalid, joinIds } from './control';
import type { InputProps } from './input';

export interface PhoneInputProps extends Omit<InputProps, 'type' | 'prefix'> {
  /** Country code shown before the number. Sri Lanka by default. */
  countryCode?: string;
}

/**
 * Sri Lankan mobile number with a fixed `+94` box in front.
 *
 * - `type="tel"` + `inputMode="tel"` → the phone keypad on Android/iOS.
 * - `autoComplete="tel"` → browsers can fill the saved number (with or without +94).
 * - The `+94` box is real text referenced by `aria-describedby`, so screen readers hear it.
 * - Accepts what people type (`077 123 4567`, `77-123-4567`, `+94…`); normalise on the server
 *   with `sriLankaMobile` from `@remix/types`.
 */
export function PhoneInput({
  countryCode = '+94',
  controlSize = 'md',
  invalid,
  className,
  'aria-invalid': ariaInvalid,
  'aria-describedby': describedBy,
  ...props
}: PhoneInputProps) {
  const prefixId = `phone-prefix-${useId()}`;
  const bad = invalid ?? isInvalid(ariaInvalid);

  return (
    <div className={controlGroupClass({ size: controlSize, invalid: bad, className })}>
      <span
        id={prefixId}
        className={cn(
          'bg-canvas text-ink-2 tabular flex flex-none select-none items-center border-r px-3.5 font-medium',
          bad ? 'border-danger' : 'border-line-strong',
        )}
      >
        {countryCode}
      </span>
      <input
        type="tel"
        inputMode="tel"
        autoComplete="tel"
        aria-invalid={bad || undefined}
        aria-describedby={joinIds(prefixId, describedBy)}
        className={cn(groupInputClass, 'tabular tracking-[0.02em]')}
        {...props}
      />
    </div>
  );
}
