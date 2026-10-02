import type { ComponentPropsWithoutRef, ReactNode } from 'react';
import { cn } from '../cn';

export type StatusTone = 'success' | 'warning' | 'danger' | 'info' | 'neutral';

export interface StatusBadgeProps extends Omit<ComponentPropsWithoutRef<'span'>, 'children'> {
  tone: StatusTone;
  /** The status word ("Paid", "Unpaid", "Slip waiting"). Required: status is never colour alone. */
  children: ReactNode;
  /**
   * Leading mark. Default: a small dot. Pass a 12–14 px Lucide icon (`<Check size={12} />`) or
   * `null` for text only. Always decorative — the word carries the meaning.
   */
  icon?: ReactNode;
  /** `outline` = no fill, for quiet states like "Scheduled". */
  appearance?: 'soft' | 'outline';
}

const soft: Record<StatusTone, string> = {
  success: 'bg-success-soft text-success-ink',
  warning: 'bg-warning-soft text-warning-ink',
  danger: 'bg-danger-soft text-danger-ink',
  info: 'bg-info-soft text-info-ink',
  neutral: 'bg-line-soft text-ink-2',
};

const dot: Record<StatusTone, string> = {
  success: 'bg-success',
  warning: 'bg-warning',
  danger: 'bg-danger',
  info: 'bg-info',
  neutral: 'bg-muted',
};

/** Fee/class/tenant status pill: word + colour (+ dot or icon). Server-compatible. */
export function StatusBadge({
  tone,
  children,
  icon,
  appearance = 'soft',
  className,
  ...props
}: StatusBadgeProps) {
  const mark =
    icon === undefined ? (
      <span className={cn('size-1.5 flex-none rounded-full', dot[tone])} />
    ) : (
      icon
    );
  return (
    <span
      className={cn(
        'rounded-xs inline-flex h-[22px] items-center gap-1.5 whitespace-nowrap px-2 text-xs font-semibold',
        appearance === 'soft' ? soft[tone] : 'border-line text-muted border',
        className,
      )}
      {...props}
    >
      {mark ? (
        <span aria-hidden className="flex flex-none items-center">
          {mark}
        </span>
      ) : null}
      {children}
    </span>
  );
}
