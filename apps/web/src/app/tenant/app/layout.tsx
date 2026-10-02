import { tenantAccess, type SessionResponse } from '@remix/types/api';
import { ShellTenant, ShellUser } from '@remix/ui';
import { BookOpen, House, User, Video, Wallet } from 'lucide-react';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import { IntlIsland } from '@/components/intl-island';
import { AppFrame, type FrameNavItem } from '@/components/shell/app-frame';
import { ShellHeader, shellTenantProps } from '@/components/shell/shell-header';
import { TenantUnavailable, unavailableMetadata } from '@/components/tenant/tenant-unavailable';
import { initials } from '@/lib/initials';
import { PORTAL_PATHS, TENANT_PATHS } from '@/lib/paths';
import { getTenant, problemCode, requireStudent } from '@/server/api';

/**
 * Student portal (`/app`, DESIGN.md §4.2). Signed-in students of this institute only; while the
 * institute is suspended or cancelled the portal shows the neutral unavailable page (TEN-06).
 */

export async function generateMetadata(): Promise<Metadata> {
  const tenant = await getTenant();
  if (!tenantAccess(tenant.status).studentPortal) return unavailableMetadata();
  return { robots: { index: false, follow: false } };
}

export default async function PortalLayout({ children }: { children: ReactNode }) {
  const tenant = await getTenant();
  // Checked before the session: the API refuses a suspended institute's sessions anyway.
  if (!tenantAccess(tenant.status).studentPortal) return <TenantUnavailable name={tenant.name} />;

  let session: SessionResponse;
  try {
    session = await requireStudent();
  } catch (err) {
    // The institute went unavailable between the two calls. Anything else (including the
    // guard's redirect) propagates.
    if (problemCode(err) === 'TENANT_UNAVAILABLE') return <TenantUnavailable name={tenant.name} />;
    throw err;
  }

  const t = await getTranslations('portal');
  const nav: FrameNavItem[] = [
    { href: PORTAL_PATHS.home, label: t('nav.home'), icon: <House />, exact: true },
    { href: PORTAL_PATHS.classes, label: t('nav.classes'), icon: <BookOpen /> },
    { href: PORTAL_PATHS.pay, label: t('nav.pay'), icon: <Wallet /> },
    { href: PORTAL_PATHS.live, label: t('nav.live'), icon: <Video /> },
    { href: PORTAL_PATHS.me, label: t('nav.me'), icon: <User /> },
  ];
  const name = session.user.displayName;

  return (
    <IntlIsland namespaces={['common']}>
      <AppFrame
        kind="portal"
        nav={nav}
        navLabel={t('nav.label')}
        mobileNavLabel={t('nav.tabsLabel')}
        skipLinkLabel={t('shell.skipToContent')}
        tenant={<ShellTenant {...shellTenantProps(tenant)} />}
        user={<ShellUser name={name} meta={t('shell.student')} initials={initials(name)} />}
        header={<ShellHeader tenant={tenant} logoutTo={TENANT_PATHS.studentLogin} />}
      >
        {children}
      </AppFrame>
    </IntlIsland>
  );
}
