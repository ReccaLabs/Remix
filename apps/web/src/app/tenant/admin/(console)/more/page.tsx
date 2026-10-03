import { can } from '@remix/types';
import { ShellUser } from '@remix/ui';
import { ChevronRight, Menu, Settings } from 'lucide-react';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { AdminComingSoon } from '@/components/admin/admin-coming-soon';
import { LogoutButton } from '@/components/auth/logout-button';
import { initials } from '@/lib/initials';
import { ADMIN_PATHS, TENANT_PATHS } from '@/lib/paths';
import { requireStaff } from '@/server/api';
import { formatRoles } from '@/server/staff';
import { adminMetadata } from '@/server/metadata';

// Admin "More" (Admin Dashboard Mobile 17b): the signed-in person and Log out now; lessons, live
// classes, settings and integrations are listed here as they are built.

export const generateMetadata = () => adminMetadata('more');

export default async function MorePage() {
  const session = await requireStaff();
  const [t, roles] = await Promise.all([
    getTranslations('admin.more'),
    formatRoles(session.user.roles),
  ]);
  const name = session.user.displayName;
  return (
    <AdminComingSoon section="more" icon={<Menu />}>
      <section
        aria-label={t('account')}
        className="bg-surface border-line flex flex-wrap items-center justify-between gap-3 rounded-lg border p-4"
      >
        <ShellUser name={name} meta={roles} initials={initials(name)} />
        <LogoutButton redirectTo={TENANT_PATHS.staffLogin} />
      </section>
      {can(session.user.roles, 'staff.manage') ? (
        <Link
          href={ADMIN_PATHS.staff}
          className="bg-surface border-line hover:border-brand flex min-h-11 items-center gap-3 rounded-lg border p-4"
        >
          <Settings aria-hidden size={20} className="text-muted flex-none" />
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="font-medium">{t('staffLink')}</span>
            <span className="text-muted text-sm">{t('staffHint')}</span>
          </span>
          <ChevronRight aria-hidden size={18} className="text-muted flex-none" />
        </Link>
      ) : null}
    </AdminComingSoon>
  );
}
