import { can } from '@remix/types';
import { tenantAccess, type SessionResponse } from '@remix/types/api';
import { ShellTenant } from '@remix/ui';
import { BookOpen, LayoutDashboard, Menu, Settings, Users, Wallet } from 'lucide-react';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import { LogoutButton } from '@/components/auth/logout-button';
import { IntlIsland } from '@/components/intl-island';
import { AppFrame, type FrameNavItem } from '@/components/shell/app-frame';
import { ShellHeader, shellTenantProps } from '@/components/shell/shell-header';
import { StatusPage } from '@/components/status-page';
import { TenantUnavailable, unavailableMetadata } from '@/components/tenant/tenant-unavailable';
import { ADMIN_PATHS, TENANT_PATHS } from '@/lib/paths';
import { getTenant, problemCode, requireStaff } from '@/server/api';
import { formatRoles } from '@/server/staff';

/**
 * Institute admin (`/admin`, DESIGN.md §4.3). Signed-in staff of this institute only. TEN-06:
 * a cancelled institute shows the neutral unavailable page; a suspended one lets staff in to a
 * billing-only notice (the billing pages themselves come in Phase 7).
 */

export async function generateMetadata(): Promise<Metadata> {
  const tenant = await getTenant();
  if (tenantAccess(tenant.status).staff === 'none') return unavailableMetadata();
  return { robots: { index: false, follow: false } };
}

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const tenant = await getTenant();
  const access = tenantAccess(tenant.status).staff;
  if (access === 'none') return <TenantUnavailable name={tenant.name} />;

  let session: SessionResponse;
  try {
    session = await requireStaff();
  } catch (err) {
    if (problemCode(err) === 'TENANT_UNAVAILABLE') return <TenantUnavailable name={tenant.name} />;
    throw err;
  }

  const t = await getTranslations('admin');

  if (access === 'billing-only') {
    return (
      <IntlIsland namespaces={['common']}>
        <StatusPage
          title={t('billingOnly.title', { name: tenant.name })}
          body={t('billingOnly.body')}
        >
          <LogoutButton redirectTo={TENANT_PATHS.staffLogin} />
        </StatusPage>
      </IntlIsland>
    );
  }

  const nav: FrameNavItem[] = [
    { href: ADMIN_PATHS.home, label: t('nav.dashboard'), icon: <LayoutDashboard />, exact: true },
    { href: ADMIN_PATHS.students, label: t('nav.students'), icon: <Users /> },
    { href: ADMIN_PATHS.classes, label: t('nav.classes'), icon: <BookOpen /> },
    { href: ADMIN_PATHS.fees, label: t('nav.fees'), icon: <Wallet /> },
    // Owners manage staff and roles (STF-01); everyone else has nothing to open here yet.
    ...(can(session.user.roles, 'staff.manage')
      ? [{ href: ADMIN_PATHS.staff, label: t('nav.settings'), icon: <Settings /> }]
      : []),
  ];
  const mobileNav: FrameNavItem[] = [
    { href: ADMIN_PATHS.home, label: t('nav.home'), icon: <LayoutDashboard />, exact: true },
    { href: ADMIN_PATHS.students, label: t('nav.students'), icon: <Users /> },
    { href: ADMIN_PATHS.fees, label: t('nav.feesShort'), icon: <Wallet /> },
    { href: ADMIN_PATHS.classes, label: t('nav.classes'), icon: <BookOpen /> },
    { href: ADMIN_PATHS.more, label: t('nav.more'), icon: <Menu /> },
  ];

  return (
    <IntlIsland namespaces={['common']}>
      <AppFrame
        kind="admin"
        nav={nav}
        mobileNav={mobileNav}
        navLabel={t('nav.label')}
        mobileNavLabel={t('nav.tabsLabel')}
        skipLinkLabel={t('shell.skipToContent')}
        tenant={<ShellTenant {...shellTenantProps(tenant)} />}
        header={
          <ShellHeader
            tenant={tenant}
            user={{ name: session.user.displayName, meta: await formatRoles(session.user.roles) }}
            logoutTo={TENANT_PATHS.staffLogin}
          />
        }
      >
        {children}
      </AppFrame>
    </IntlIsland>
  );
}
