import { LoaderCircle } from 'lucide-react';
import type { ComponentPropsWithRef } from 'react';
import { buttonClass, type ButtonSize, type ButtonVariant } from '../button';
import { cn } from '../cn';

export interface ButtonProps extends ComponentPropsWithRef<'button'> {
  variant?: ButtonVariant;
  /** sm 36 · md 40 · lg 48 · xl 52. On touch screens every size grows to ≥ 44 px. */
  size?: ButtonSize;
  /**
   * Shows a spinner, disables the button and sets `aria-busy`. Keep the visible label (e.g.
   * "Saving…" passed as children) so screen readers hear what is happening.
   */
  loading?: boolean;
  /** Stretch to the container width (mobile forms). */
  block?: boolean;
}

/**
 * `<button>` with the shared `buttonClass` styles. Use `buttonClass()` directly for links.
 * Defaults to `type="button"` so a button inside a form never submits by accident.
 */
export function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  block = false,
  disabled,
  type = 'button',
  className,
  children,
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={buttonClass({
        variant,
        size,
        className: cn(
          // Dense desktop sizes keep a 44 px target where the pointer is a finger.
          'pointer-coarse:min-h-11',
          block && 'w-full',
          loading && 'disabled:cursor-progress',
          className,
        ),
      })}
      {...props}
    >
      {loading ? (
        <LoaderCircle
          aria-hidden
          size={size === 'sm' ? 16 : 18}
          className="flex-none motion-safe:animate-spin"
        />
      ) : null}
      {children}
    </button>
  );
}
