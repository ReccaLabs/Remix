import type { ReactNode } from 'react';
import { cn } from '../cn';
import type { LinkComponent } from '../link';
import { BottomTabs, SidebarNav, type ShellNavItem, type ShellTone } from './nav';

/** Props shared by PortalShell, AdminShell and PlatformShell. */
export interface ShellProps {
  /** Sidebar navigation (desktop, `lg` and up). */
  nav: readonly ShellNavItem[];
  /** Bottom tab bar on phones/tablets. Defaults to `nav`; keep it to 4–5 items. */
  mobileNav?: readonly ShellNavItem[];
  /** Accessible name of the navigation landmark ("Main"). */
  navLabel: string;
  /** Accessible name of the bottom tab bar. Defaults to `navLabel`. */
  mobileNavLabel?: string;
  /** Text of the skip link ("Skip to content"). */
  skipLinkLabel: string;
  /** Top of the sidebar: institute name/logo (use <ShellTenant>) or the platform brand. */
  tenant?: ReactNode;
  /** Bottom of the sidebar: the signed-in person (use <ShellUser>). */
  user?: ReactNode;
  /** Above the user in the sidebar, e.g. plan usage. */
  sidebarFooter?: ReactNode;
  /**
   * Top bar contents (search, language switch, notifications…). Rendered in a sticky
   * <header> on every size; hide parts per breakpoint with `lg:hidden` / `hidden lg:flex`.
   */
  header?: ReactNode;
  /** Router link (Next.js `Link`). Defaults to `<a>`. */
  linkComponent?: LinkComponent;
  /** id of <main>, the skip link target. */
  mainId?: string;
  children: ReactNode;
  className?: string;
}

interface FrameConfig {
  sidebarTone: ShellTone;
  sidebarClass: string;
  headerClass: string;
  dense: boolean;
}

/**
 * Layout shared by the three app shells:
 * - `lg`+ : fixed-width sticky sidebar (tenant · nav · footer · user) + content column.
 * - below : content + fixed bottom tab bar (safe-area aware); the sidebar is not rendered visibly.
 * Brand colours come from `--color-brand*`, so a tenant's colour applies automatically.
 */
export function ShellFrame({
  config,
  nav,
  mobileNav,
  navLabel,
  mobileNavLabel,
  skipLinkLabel,
  tenant,
  user,
  sidebarFooter,
  header,
  linkComponent = 'a',
  mainId = 'main',
  children,
  className,
}: ShellProps & { config: FrameConfig }) {
  const dark = config.sidebarTone === 'dark';
  return (
    <div
      className={cn(
        'bg-canvas text-ink min-h-dvh text-[15px] leading-[22px] lg:flex lg:text-sm lg:leading-5',
        'si:text-base si:leading-[26px] ta:text-base ta:leading-[26px] lg:si:text-[15px] lg:si:leading-6 lg:ta:text-[15px] lg:ta:leading-6',
        className,
      )}
    >
      <a
        href={`#${mainId}`}
        className="bg-surface text-brand shadow-card sr-only z-[60] rounded-md px-4 py-3 font-semibold focus:not-sr-only focus:fixed focus:left-3 focus:top-3"
      >
        {skipLinkLabel}
      </a>

      <div
        className={cn(
          'hidden flex-none flex-col gap-4 overflow-y-auto px-3 pb-3 pt-4 lg:sticky lg:top-0 lg:flex lg:h-dvh',
          config.sidebarClass,
        )}
      >
        {tenant ? <div className="px-2">{tenant}</div> : null}
        <SidebarNav
          items={nav}
          label={navLabel}
          tone={config.sidebarTone}
          dense={config.dense}
          Link={linkComponent}
        />
        {sidebarFooter || user ? (
          <div className="mt-auto flex flex-col gap-3">
            {sidebarFooter}
            {user ? (
              <div
                className={cn(
                  'border-t px-2 pt-3',
                  dark ? 'border-night-line' : 'border-line-soft',
                )}
              >
                {user}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="flex min-w-0 flex-1 flex-col">
        {header ? (
          <header
            className={cn(
              'lg:min-h-15 sticky top-0 z-30 flex min-h-14 items-center gap-3 px-4 lg:gap-4 lg:px-8',
              config.headerClass,
            )}
          >
            {header}
          </header>
        ) : null}
        <main
          id={mainId}
          tabIndex={-1}
          className="min-w-0 flex-1 pb-[calc(4rem+env(safe-area-inset-bottom))] outline-none lg:pb-0"
        >
          {children}
        </main>
      </div>

      <BottomTabs
        items={mobileNav ?? nav}
        label={mobileNavLabel ?? navLabel}
        Link={linkComponent}
      />
    </div>
  );
}
