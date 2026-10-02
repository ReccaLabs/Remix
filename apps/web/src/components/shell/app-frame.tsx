'use client';

import { AdminShell, PortalShell, type ShellNavItem, type ShellProps } from '@remix/ui';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { isActivePath } from '@/lib/nav';

/** A nav entry before the active state is known. `exact` for section homes (`/app`, `/admin`). */
export interface FrameNavItem {
  href: string;
  label: string;
  icon: ReactNode;
  exact?: boolean;
}

/**
 * Client wrapper around the UI kit's PortalShell/AdminShell. Layouts don't re-render when the
 * user moves between sibling pages, so the active nav item comes from `usePathname()` here.
 * Everything else (labels, icons, header, page content) is rendered on the server and passed in.
 */
export function AppFrame({
  kind,
  nav,
  mobileNav,
  ...props
}: Omit<ShellProps, 'nav' | 'mobileNav' | 'linkComponent'> & {
  kind: 'portal' | 'admin';
  nav: readonly FrameNavItem[];
  mobileNav?: readonly FrameNavItem[];
}) {
  const pathname = usePathname();
  const withActive = (items: readonly FrameNavItem[]): ShellNavItem[] =>
    items.map(({ exact, ...item }) => ({
      ...item,
      active: isActivePath(pathname, item.href, exact),
    }));

  const Shell = kind === 'portal' ? PortalShell : AdminShell;
  return (
    <Shell
      {...props}
      nav={withActive(nav)}
      mobileNav={mobileNav ? withActive(mobileNav) : undefined}
      linkComponent={Link}
    />
  );
}
