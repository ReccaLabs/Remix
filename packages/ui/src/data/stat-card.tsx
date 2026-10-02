import type { ReactNode } from 'react';
import { cn } from '../cn';

export interface StatCardProps {
  /** What is counted ("Unpaid students", "Fees collected · Sep 2026"). */
  label: ReactNode;
  /** The number, already formatted (`formatLKR`, `Intl.NumberFormat`). */
  value: ReactNode;
  /** Quiet context after the value ("of 468"). */
  context?: ReactNode;
  /**
   * Line under the value. A coloured tone must come with an icon or words that carry the meaning
   * on their own ("Sep 2026 fee not paid"), never colour alone.
   */
  detail?: { text: ReactNode; tone?: 'muted' | 'success' | 'warning' | 'danger'; icon?: ReactNode };
  /** Progress towards a target, exposed as a progressbar. */
  progress?: {
    value: number;
    max?: number;
    /** Accessible name ("Fees collected"). */
    label: string;
    /** Visible + spoken value, e.g. "82%". Defaults to the rounded percentage. */
    valueText?: string;
  };
  /** One link or small button at the bottom ("View list"). */
  action?: ReactNode;
  /** `attention` = amber card for queues that need someone (bank slips waiting). */
  tone?: 'default' | 'attention';
  /** Icon before the label (decorative). */
  icon?: ReactNode;
  className?: string;
}

const detailTone = {
  muted: 'text-muted',
  success: 'text-success-ink',
  warning: 'text-warning-ink',
  danger: 'text-danger-ink',
} as const;

/** Dashboard number card (Institute Dashboard, Platform Admin). Server-compatible. */
export function StatCard({
  label,
  value,
  context,
  detail,
  progress,
  action,
  tone = 'default',
  icon,
  className,
}: StatCardProps) {
  const max = progress?.max ?? 100;
  const pct = progress ? Math.min(100, Math.max(0, (progress.value / max) * 100)) : 0;
  const valueText = progress?.valueText ?? `${Math.round(pct)}%`;

  return (
    <div
      className={cn(
        'flex flex-col gap-2.5 rounded-md border px-4 py-4 lg:px-[18px]',
        tone === 'attention' ? 'bg-accent-tint border-accent-line' : 'bg-surface border-line',
        className,
      )}
    >
      <p
        className={cn(
          'm-0 flex items-center gap-1.5 text-[13px] font-medium lg:text-sm',
          tone === 'attention' ? 'text-warning-ink' : 'text-muted',
        )}
      >
        {icon ? (
          <span aria-hidden className="flex flex-none [&_svg]:size-4">
            {icon}
          </span>
        ) : null}
        {label}
      </p>
      <p className="tabular m-0 flex flex-wrap items-baseline gap-x-2">
        <span className="text-2xl font-semibold tracking-[-0.02em] lg:text-[26px] lg:leading-8">
          {value}
        </span>
        {context ? <span className="text-muted text-sm">{context}</span> : null}
      </p>
      {progress ? (
        <div className="flex items-center gap-2.5">
          <div
            role="progressbar"
            aria-label={progress.label}
            aria-valuemin={0}
            aria-valuemax={max}
            aria-valuenow={progress.value}
            aria-valuetext={valueText}
            className="bg-line-soft h-1.5 flex-1 overflow-hidden rounded-full"
          >
            <div className="bg-brand h-full rounded-full" style={{ width: `${pct}%` }} />
          </div>
          <span aria-hidden className="tabular text-[13px] font-semibold">
            {valueText}
          </span>
        </div>
      ) : null}
      {detail ? (
        <p
          className={cn(
            'm-0 flex items-center gap-1.5 text-[13px]',
            detailTone[detail.tone ?? 'muted'],
          )}
        >
          {detail.icon ? (
            <span aria-hidden className="flex flex-none [&_svg]:size-3.5">
              {detail.icon}
            </span>
          ) : null}
          {detail.text}
        </p>
      ) : null}
      {action ? <div className="mt-auto pt-0.5 text-[13px] font-medium">{action}</div> : null}
    </div>
  );
}
