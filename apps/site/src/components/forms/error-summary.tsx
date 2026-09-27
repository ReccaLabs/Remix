'use client';

import { cn } from '@remix/ui';
import { AlertCircle } from 'lucide-react';
import type { Ref } from 'react';

export type ErrorSummaryItem = { id: string; message: string };

/**
 * List of everything wrong with a form, shown above the submit button after a failed attempt.
 * Each entry links to (and focuses) its field. The form itself moves focus to the first invalid
 * field, whose error is read out through aria-describedby.
 */
export function ErrorSummary({
  title,
  items,
  ref,
  className,
}: {
  title: string;
  items: ErrorSummaryItem[];
  ref?: Ref<HTMLDivElement>;
  className?: string;
}) {
  if (items.length === 0) return null;
  return (
    <div
      ref={ref}
      tabIndex={-1}
      aria-labelledby="error-summary-title"
      className={cn('border-danger bg-danger-soft rounded-md border px-4 py-3', className)}
    >
      <p
        id="error-summary-title"
        className="text-danger-ink m-0 flex items-center gap-2 font-semibold"
      >
        <AlertCircle size={18} aria-hidden className="flex-none" />
        {title}
      </p>
      <ul className="m-0 mt-1.5 flex list-none flex-col gap-1 p-0 pl-[26px] text-sm">
        {items.map((item) => (
          <li key={item.id}>
            <a
              href={`#${item.id}`}
              className="text-danger-ink underline underline-offset-2"
              onClick={(e) => {
                const el = document.getElementById(item.id);
                if (!el) return;
                e.preventDefault();
                el.focus();
                el.scrollIntoView({ block: 'center' });
              }}
            >
              {item.message}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
