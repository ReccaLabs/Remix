import type { ReactNode } from 'react';
import { cn } from '../cn';
import type { LinkComponent } from '../link';

export interface ShellNavBadge {
  /** Short visible text ("18"). Omit for a dot. */
  text?: string;
  /** Spoken text, appended to the link name ("18 bank slips waiting"). */
  label: string;
  tone?: 'danger' | 'warning';
}

export interface ShellNavItem {
  href: string;
  /** Localised label. */
  label: string;
  /** Lucide icon element (`<Users />`); sized by the shell, hidden from screen readers. */
  icon: ReactNode;
  /** The current section. Rendered with `aria-current="page"`. */
  active?: boolean;
  badge?: ShellNavBadge;
}

export type ShellTone = 'light' | 'dark';

/** Desktop sidebar list. Light (portal/admin) or dark (platform). */
export function SidebarNav({
  items,
  label,
  tone,
  dense,
  Link,
}: {
  items: readonly ShellNavItem[];
  label: string;
  tone: ShellTone;
  dense: boolean;
  Link: LinkComponent;
}) {
  return (
    <nav aria-label={label}>
      <ul className="m-0 flex list-none flex-col gap-0.5 p-0">
        {items.map((item) => (
          <li key={item.href}>
            <Link
              href={item.href}
              aria-current={item.active ? 'page' : undefined}
              className={cn(
                'flex items-center gap-2.5 rounded-sm px-2.5 py-2 font-medium no-underline transition-colors duration-150 hover:no-underline',
                dense ? 'min-h-9' : 'min-h-10',
                'pointer-coarse:min-h-11',
                tone === 'light'
                  ? item.active
                    ? 'bg-brand-soft text-brand hover:text-brand'
                    : 'text-ink-2 hover:bg-canvas hover:text-ink'
                  : item.active
                    ? 'bg-night-line text-white hover:text-white'
                    : 'text-night-muted hover:bg-night-2 hover:text-white',
              )}
            >
              <span aria-hidden className="flex flex-none [&_svg]:size-5">
                {item.icon}
              </span>
              <span className="min-w-0 flex-1">{item.label}</span>
              {item.badge ? <SidebarBadge badge={item.badge} tone={tone} /> : null}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

function SidebarBadge({ badge, tone }: { badge: ShellNavBadge; tone: ShellTone }) {
  const colour =
    tone === 'dark'
      ? 'bg-warning text-night'
      : badge.tone === 'warning'
        ? 'bg-warning-soft text-warning-ink'
        : 'bg-danger-soft text-danger-ink';
  return (
    <>
      {badge.text ? (
        <span
          aria-hidden
          className={cn(
            'tabular rounded-xs flex-none px-1.5 text-xs font-semibold leading-[18px]',
            colour,
          )}
        >
          {badge.text}
        </span>
      ) : (
        <span aria-hidden className="bg-danger size-2 flex-none rounded-full" />
      )}{' '}
      <span className="sr-only">{badge.label}</span>
    </>
  );
}

/** Phone bottom tab bar (hidden from `lg`). Always light, active tab in the brand colour. */
export function BottomTabs({
  items,
  label,
  Link,
}: {
  items: readonly ShellNavItem[];
  label: string;
  Link: LinkComponent;
}) {
  return (
    <nav
      aria-label={label}
      className="bg-surface border-line fixed inset-x-0 bottom-0 z-40 border-t pb-[env(safe-area-inset-bottom)] lg:hidden"
    >
      <ul className="m-0 grid h-16 list-none auto-cols-fr grid-flow-col p-0 px-2">
        {items.map((item) => (
          <li key={item.href} className="min-w-0">
            <Link
              href={item.href}
              aria-current={item.active ? 'page' : undefined}
              className={cn(
                'flex h-full min-h-11 flex-col items-center justify-center gap-0.5 rounded-sm px-1 text-[11px] font-medium leading-4 no-underline hover:no-underline',
                'focus-visible:-outline-offset-2',
                item.active ? 'text-brand hover:text-brand' : 'text-muted hover:text-ink',
              )}
            >
              <span aria-hidden className="relative flex [&_svg]:size-6">
                {item.icon}
                {item.badge ? (
                  item.badge.text ? (
                    <span className="bg-danger tabular absolute -top-1 left-[calc(100%-6px)] min-w-4 rounded-full px-1 text-center text-[10px] font-semibold leading-4 text-white">
                      {item.badge.text}
                    </span>
                  ) : (
                    <span className="bg-danger border-surface absolute -top-0.5 left-[calc(100%-4px)] size-2.5 rounded-full border-2" />
                  )
                ) : null}
              </span>
              <span className="max-w-full truncate">{item.label}</span>
              {item.badge ? (
                <>
                  {' '}
                  <span className="sr-only">{item.badge.label}</span>
                </>
              ) : null}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
