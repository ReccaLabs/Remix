import type { ComponentPropsWithRef } from 'react';
import { cn } from '../cn';
import { controlFrameClass, isInvalid, type ControlSize } from './control';

export interface InputProps extends ComponentPropsWithRef<'input'> {
  /** `md` 44 px (admin) · `lg` 52 px on phones / 48 px from md (student portal). */
  controlSize?: ControlSize;
  /** Marks the control invalid. Inside <Field> this is set for you from `error`. */
  invalid?: boolean;
}

/** Text input. Wrap it in <Field> for the label, hint and error wiring. */
export function Input({
  controlSize = 'md',
  invalid,
  className,
  'aria-invalid': ariaInvalid,
  ...props
}: InputProps) {
  const bad = invalid ?? isInvalid(ariaInvalid);
  return (
    <input
      aria-invalid={bad || undefined}
      className={controlFrameClass({
        size: controlSize,
        invalid: bad,
        className: cn('px-3', className),
      })}
      {...props}
    />
  );
}
