import type { ReactNode } from 'react';
import { cn } from '../cn';
import type { ShellTone } from './nav';

export interface ShellTenantProps {
  /** Institute name ("Kamal Physics"). */
  name: string;
  /** Second line, e.g. the tenant domain. */
  subtitle?: ReactNode;
  /** Logo element; replaces the initials tile. Give it empty alt — the name is next to it. */
  logo?: ReactNode;
  /** 1–2 letters for the brand tile when there is no logo ("KP"). */
  initials?: string;
  tone?: ShellTone;
  className?: string;
}

/** Institute identity block for the sidebar or a mobile top bar. Tile uses the tenant brand. */
export function ShellTenant({
  name,
  subtitle,
  logo,
  initials,
  tone = 'light',
  className,
}: ShellTenantProps) {
  return (
    <div className={cn('flex min-w-0 items-center gap-2.5', className)}>
      {logo ? (
        <span className="flex size-9 flex-none items-center justify-center overflow-hidden rounded-md">
          {logo}
        </span>
      ) : initials ? (
        <span
          aria-hidden
          className="bg-brand flex size-9 flex-none items-center justify-center rounded-md text-sm font-bold tracking-[-0.02em] text-white"
        >
          {initials}
        </span>
      ) : null}
      <span className="flex min-w-0 flex-col">
        <span className={cn('truncate font-semibold', tone === 'dark' ? 'text-white' : 'text-ink')}>
          {name}
        </span>
        {subtitle ? (
          <span
            className={cn(
              'truncate text-xs leading-4',
              tone === 'dark' ? 'text-night-muted' : 'text-muted',
            )}
          >
            {subtitle}
          </span>
        ) : null}
      </span>
    </div>
  );
}

export interface ShellUserProps {
  name: string;
  /** Role or student number ("Owner", "BR-1042"). */
  meta?: ReactNode;
  /** Avatar initials when there is no photo. */
  initials?: string;
  /** Photo element (decorative; the name is shown). */
  avatar?: ReactNode;
  tone?: ShellTone;
  className?: string;
}

/** Signed-in person block (sidebar bottom, top bar, "More" page). */
export function ShellUser({
  name,
  meta,
  initials,
  avatar,
  tone = 'light',
  className,
}: ShellUserProps) {
  return (
    <div className={cn('flex min-w-0 items-center gap-2.5', className)}>
      <span
        aria-hidden
        className={cn(
          'flex size-8 flex-none items-center justify-center overflow-hidden rounded-full text-xs font-semibold',
          tone === 'dark' ? 'bg-night-line text-white' : 'bg-line text-ink',
        )}
      >
        {avatar ?? initials}
      </span>
      <span className="flex min-w-0 flex-col">
        <span
          className={cn(
            'truncate text-[13px] font-medium leading-4',
            tone === 'dark' ? 'text-white' : 'text-ink',
          )}
        >
          {name}
        </span>
        {meta ? (
          <span
            className={cn(
              'truncate text-xs leading-4',
              tone === 'dark' ? 'text-night-muted' : 'text-muted',
            )}
          >
            {meta}
          </span>
        ) : null}
      </span>
    </div>
  );
}
