import type { CSSProperties } from 'react';
import { cn } from '../cn';

export interface SkeletonProps {
  /** Size with classes (`h-4 w-32`); `text` gives a 1-line text bar by default. */
  className?: string;
  shape?: 'rect' | 'text' | 'circle';
  /** Geometry only (e.g. a width that varies per row). */
  style?: CSSProperties;
}

/**
 * Loading placeholder. Decorative (`aria-hidden`): the region that is loading should set
 * `aria-busy="true"` and carry a visually hidden "Loading…" text. Pulses only when the user
 * has not asked for reduced motion.
 */
export function Skeleton({ className, shape = 'rect', style }: SkeletonProps) {
  return (
    <span
      aria-hidden
      style={style}
      className={cn(
        'bg-line block motion-safe:animate-pulse',
        shape === 'rect' && 'rounded-sm',
        shape === 'text' && 'rounded-xs h-3.5 w-full',
        shape === 'circle' && 'size-8 rounded-full',
        className,
      )}
    />
  );
}
