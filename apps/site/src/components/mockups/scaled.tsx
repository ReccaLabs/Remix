import { cn } from '@remix/ui';
import type { CSSProperties, ReactNode } from 'react';

/**
 * Renders children at a fixed design size (e.g. 1440×1000) and scales them by the CSS variable
 * `--s`, reserving exactly the scaled box in layout. Set `--s` per breakpoint with Tailwind:
 *   <Scaled width={640} height={500} className="[--s:0.5] sm:[--s:0.9] md:[--s:1]">
 */
export function Scaled({
  width,
  height,
  className,
  children,
}: {
  width: number;
  height: number;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={cn('relative overflow-hidden', className)}
      style={{ width: `calc(${width}px * var(--s))`, height: `calc(${height}px * var(--s))` }}
    >
      <div
        style={
          {
            width,
            height,
            transform: 'scale(var(--s))',
            transformOrigin: '0 0',
          } as CSSProperties
        }
      >
        {children}
      </div>
    </div>
  );
}
