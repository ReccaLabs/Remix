'use client';

import { cn } from '@remix/ui';
import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';

export interface TabItem {
  id: string;
  label: string;
  panel: ReactNode;
}

/**
 * Accessible tabs (WAI-ARIA tabs pattern: roving tabindex, arrow/Home/End keys).
 * Panels are server-rendered ReactNodes passed in, so only this small shell ships as JS.
 */
export function Tabs({
  items,
  label,
  className,
  panelClassName,
}: {
  items: TabItem[];
  label: string;
  className?: string;
  panelClassName?: string;
}) {
  const [active, setActive] = useState(0);
  const base = useId();
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    const last = items.length - 1;
    const next =
      e.key === 'ArrowRight'
        ? active === last
          ? 0
          : active + 1
        : e.key === 'ArrowLeft'
          ? active === 0
            ? last
            : active - 1
          : e.key === 'Home'
            ? 0
            : e.key === 'End'
              ? last
              : null;
    if (next === null) return;
    e.preventDefault();
    setActive(next);
    refs.current[next]?.focus();
  };

  return (
    <div className={cn('flex flex-col gap-8', className)}>
      <div
        role="tablist"
        aria-label={label}
        className="bg-paper-2 border-line-warm flex gap-1 self-start rounded-[12px] border p-1 sm:self-end"
      >
        {items.map((item, i) => (
          <button
            key={item.id}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="tab"
            id={`${base}-tab-${item.id}`}
            aria-selected={active === i}
            aria-controls={`${base}-panel-${item.id}`}
            tabIndex={active === i ? 0 : -1}
            onClick={() => setActive(i)}
            onKeyDown={onKeyDown}
            className={cn(
              'h-10 cursor-pointer rounded-sm border-0 px-5 font-semibold transition-colors',
              active === i
                ? 'bg-surface text-ink shadow-seg'
                : 'text-muted hover:text-ink bg-transparent',
            )}
          >
            {item.label}
          </button>
        ))}
      </div>
      {items.map((item, i) => (
        <div
          key={item.id}
          role="tabpanel"
          id={`${base}-panel-${item.id}`}
          aria-labelledby={`${base}-tab-${item.id}`}
          hidden={active !== i}
          tabIndex={0}
          className={panelClassName}
        >
          {item.panel}
        </div>
      ))}
    </div>
  );
}
