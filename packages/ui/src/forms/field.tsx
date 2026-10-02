import { CircleAlert } from 'lucide-react';
import {
  cloneElement,
  isValidElement,
  useId,
  type AriaAttributes,
  type ReactElement,
  type ReactNode,
} from 'react';
import { cn } from '../cn';
import { joinIds } from './control';

/** Props <Field> injects into its control. Any input-like element accepting these works. */
export interface FieldControlProps {
  id?: string;
  'aria-describedby'?: string;
  'aria-invalid'?: AriaAttributes['aria-invalid'];
}

export interface FieldProps {
  /** Visible label text (localised). Required: every control needs a name. */
  label: ReactNode;
  /** Help text under the control, wired with aria-describedby. */
  hint?: ReactNode;
  /** Error message. Sets aria-invalid on the control and is read before the hint. */
  error?: ReactNode;
  /** Localised word for "optional", shown after the label: `Email (optional)`. */
  optional?: string;
  /** Something aligned right of the label, e.g. a "Forgot password?" link. */
  labelAside?: ReactNode;
  /** Control id. Generated when omitted. */
  id?: string;
  /** Exactly one control: <Input>, <PasswordInput>, <PhoneInput>, a native <select>… */
  children: ReactElement<FieldControlProps>;
  className?: string;
}

/**
 * Label + control + hint + error, with the accessibility wiring done once:
 * `<label for>`, `aria-describedby` (error first, then hint) and `aria-invalid`.
 * Errors are an icon plus words, never colour alone. Server-compatible.
 */
export function Field({
  label,
  hint,
  error,
  optional,
  labelAside,
  id,
  children,
  className,
}: FieldProps) {
  const generated = useId();
  const controlId = id ?? children.props.id ?? `field-${generated}`;
  const hintId = hint ? `${controlId}-hint` : undefined;
  const errorId = error ? `${controlId}-error` : undefined;

  const control = isValidElement(children)
    ? cloneElement(children, {
        id: controlId,
        'aria-describedby': joinIds(errorId, hintId, children.props['aria-describedby']),
        'aria-invalid': error ? true : children.props['aria-invalid'],
      })
    : children;

  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor={controlId} className="text-ink text-sm font-medium">
          {label}
          {optional ? (
            <>
              {' '}
              <span className="text-muted font-normal">({optional})</span>
            </>
          ) : null}
        </label>
        {labelAside ? <div className="text-sm">{labelAside}</div> : null}
      </div>
      {control}
      {hint ? (
        <p id={hintId} className="text-muted m-0 text-[13px] leading-5">
          {hint}
        </p>
      ) : null}
      {error ? <FieldError id={errorId}>{error}</FieldError> : null}
    </div>
  );
}

/** Inline error line. Exported for custom layouts (e.g. a group of radios). */
export function FieldError({
  id,
  children,
  className,
}: {
  id?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <p
      id={id}
      className={cn('text-danger-ink m-0 flex items-start gap-1.5 text-sm font-medium', className)}
    >
      <CircleAlert size={16} aria-hidden className="mt-0.5 flex-none" />
      <span>{children}</span>
    </p>
  );
}
