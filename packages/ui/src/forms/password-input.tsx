'use client';

import { Eye, EyeOff } from 'lucide-react';
import { useId, useState } from 'react';
import { cn } from '../cn';
import { controlGroupClass, groupInputClass, isInvalid } from './control';
import type { InputProps } from './input';

export interface PasswordInputProps extends Omit<InputProps, 'type'> {
  /** Accessible name of the toggle while the password is hidden ("Show password"). */
  showLabel: string;
  /** Accessible name of the toggle while the password is visible ("Hide password"). */
  hideLabel: string;
}

/**
 * Password field with a show/hide toggle. Students type on small phone keyboards, so seeing
 * what they typed prevents lock-outs. The toggle is a real 44 px button with a changing label.
 * Defaults to `autoComplete="current-password"`; pass "new-password" on sign-up/reset forms.
 */
export function PasswordInput({
  showLabel,
  hideLabel,
  controlSize = 'md',
  invalid,
  className,
  id,
  autoComplete = 'current-password',
  disabled,
  'aria-invalid': ariaInvalid,
  ...props
}: PasswordInputProps) {
  const [visible, setVisible] = useState(false);
  const generated = useId();
  const inputId = id ?? `password-${generated}`;
  const bad = invalid ?? isInvalid(ariaInvalid);

  return (
    <div className={controlGroupClass({ size: controlSize, invalid: bad, className })}>
      <input
        id={inputId}
        type={visible ? 'text' : 'password'}
        autoComplete={autoComplete}
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        disabled={disabled}
        aria-invalid={bad || undefined}
        className={groupInputClass}
        {...props}
      />
      <button
        type="button"
        aria-controls={inputId}
        aria-label={visible ? hideLabel : showLabel}
        disabled={disabled}
        onClick={() => setVisible((v) => !v)}
        className={cn(
          'text-muted hover:text-ink flex w-11 flex-none items-center justify-center',
          'focus-visible:outline-brand focus-visible:outline-2 focus-visible:-outline-offset-2',
          'disabled:cursor-not-allowed',
        )}
      >
        {visible ? <EyeOff aria-hidden size={20} /> : <Eye aria-hidden size={20} />}
      </button>
    </div>
  );
}
