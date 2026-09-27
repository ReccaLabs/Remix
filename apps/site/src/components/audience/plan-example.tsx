import { cn } from '@remix/ui';
import type { ReactNode } from 'react';

interface Row {
  label: string;
  value: string;
}

/**
 * "Example · N students" price card shared by /for-institutes and /for-teachers.
 * Purely presentational: callers compute every amount with `compare()` from @remix/types and
 * format it with `formatLKR`, so no price is ever written here.
 */
export function PlanExample({
  label,
  badge,
  example,
  lead,
  price,
  perMonth,
  rows,
  anchor,
  footer,
  className,
}: {
  /** Accessible name for the card, e.g. "Example monthly price for an institute with 800 students". */
  label: string;
  badge: string;
  example: string;
  /** Optional small line above the price ("You pay ReMix"). */
  lead?: string;
  price: string;
  perMonth: string;
  rows: Row[];
  /** The struck-through per-class-card comparison. */
  anchor: Row;
  footer?: ReactNode;
  className?: string;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className={cn(
        'border-line-warm bg-surface shadow-card tabular rounded-card flex min-w-0 flex-col gap-5 border p-6 sm:p-8',
        className,
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="bg-ink rounded-xs flex h-[26px] items-center px-2.5 text-[13px] font-semibold text-white">
          {badge}
        </span>
        <span className="text-muted text-[13px]">{example}</span>
      </div>

      <div className="flex flex-col gap-1">
        {lead && <span className="text-muted text-sm">{lead}</span>}
        <p className="font-display m-0 text-[40px] font-bold leading-[48px] tracking-[-0.02em] sm:text-[48px] sm:leading-[52px]">
          {price}
          <span className="text-muted font-sans text-base font-medium tracking-normal">
            {' '}
            {perMonth}
          </span>
        </p>
      </div>

      <dl className="border-line m-0 flex flex-col gap-2.5 border-t pt-4 text-[15px]">
        {rows.map((row) => (
          <div key={row.label} className="flex justify-between gap-4">
            <dt className="text-muted">{row.label}</dt>
            <dd className="m-0 text-right">{row.value}</dd>
          </div>
        ))}
        <div className="flex justify-between gap-4">
          <dt className="text-muted">{anchor.label}</dt>
          <dd className="text-muted m-0 text-right">
            <s>{anchor.value}</s>
          </dd>
        </div>
      </dl>

      {footer}
    </div>
  );
}
