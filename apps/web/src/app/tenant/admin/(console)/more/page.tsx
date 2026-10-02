import { ShellUser } from '@remix/ui';
import { Menu } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { AdminComingSoon } from '@/components/admin/admin-coming-soon';
import { LogoutButton } from '@/components/auth/logout-button';
import { initials } from '@/lib/initials';
import { TENANT_PATHS } from '@/lib/paths';
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
    </AdminComingSoon>
  );
}
