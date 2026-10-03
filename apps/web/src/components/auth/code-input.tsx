'use client';

import { Input, type InputProps } from '@remix/ui';

/**
 * The 6-digit SMS code: one numeric field (not six boxes — easier with screen readers, paste and
 * the phone's one-time-code autofill). Spaces are allowed; the shared schema strips them.
 */
export function CodeInput(props: Omit<InputProps, 'type' | 'inputMode' | 'autoComplete'>) {
  return (
    <Input
      type="text"
      inputMode="numeric"
      autoComplete="one-time-code"
      maxLength={7}
      spellCheck={false}
      className="font-mono text-xl tracking-[0.4em]"
      {...props}
    />
  );
}
