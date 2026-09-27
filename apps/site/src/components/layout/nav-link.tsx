'use client';

import { cn } from '@remix/ui';
import type { ComponentProps } from 'react';
import { Link, usePathname } from '@/i18n/navigation';

/** Header link that turns brand-blue and sets aria-current on its own page. */
export function NavLink({
  href,
  className,
  ...props
}: Omit<ComponentProps<typeof Link>, 'href'> & { href: string }) {
  const pathname = usePathname();
  const base = href.split('#')[0] || '/';
  const active = base !== '/' && (pathname === base || pathname.startsWith(`${base}/`));

  return (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'hover:text-ink no-underline hover:no-underline',
        active ? 'text-brand' : 'text-ink-2',
        className,
      )}
      {...props}
    />
  );
}
