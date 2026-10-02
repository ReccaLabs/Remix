import { CircleAlert } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@remix/ui';

/**
 * Form-level error (the request failed, not one field): icon + words on the danger tint,
 * announced as an alert when it appears. Field errors stay with <Field>.
 */
export function FormAlert({
  children,
  id,
  className,
}: {
  children: ReactNode;
  id?: string;
  className?: string;
}) {
  return (
    <div
      id={id}
      role="alert"
      className={cn(
        'border-danger bg-danger-soft text-danger-ink flex items-start gap-2.5 rounded-md border px-3.5 py-3 text-sm font-medium',
        className,
      )}
    >
      <CircleAlert aria-hidden size={18} className="mt-px flex-none" />
      <p className="m-0 text-pretty">{children}</p>
    </div>
  );
}
