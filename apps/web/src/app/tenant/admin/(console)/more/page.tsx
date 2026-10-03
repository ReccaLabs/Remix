import { ShellUser } from '@remix/ui';
import { CalendarDays, ChevronRight, DoorOpen, Menu, Palette, Settings } from 'lucide-react';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import { AdminComingSoon } from '@/components/admin/admin-coming-soon';
import { LogoutButton } from '@/components/auth/logout-button';
import { settingsSections, type SettingsSection } from '@/components/settings/settings-nav';
import { initials } from '@/lib/initials';
import { ADMIN_PATHS, TENANT_PATHS } from '@/lib/paths';
import { requireStaff } from '@/server/api';
import { formatRoles } from '@/server/staff';
import { adminMetadata } from '@/server/metadata';

// Admin "More" (Admin Dashboard Mobile 17b): the signed-in person and Log out, the timetable and
// the settings pages this person may open; lessons, live classes and integrations are listed here
// as they are built.

export const generateMetadata = () => adminMetadata('more');

export default async function MorePage() {
  const session = await requireStaff();
  const [t, roles] = await Promise.all([
    getTranslations('admin.more'),
    formatRoles(session.user.roles),
  ]);
  const name = session.user.displayName;

  const links: Record<
    SettingsSection,
    { href: string; title: string; hint: string; icon: ReactNode }
  > = {
    general: {
      href: ADMIN_PATHS.settings,
      title: t('generalLink'),
      hint: t('generalHint'),
      icon: <Settings aria-hidden size={20} className="text-muted flex-none" />,
    },
    theme: {
      href: ADMIN_PATHS.theme,
      title: t('themeLink'),
      hint: t('themeHint'),
      icon: <Palette aria-hidden size={20} className="text-muted flex-none" />,
    },
    halls: {
      href: ADMIN_PATHS.halls,
      title: t('hallsLink'),
      hint: t('hallsHint'),
      icon: <DoorOpen aria-hidden size={20} className="text-muted flex-none" />,
    },
    staff: {
      href: ADMIN_PATHS.staff,
      title: t('staffLink'),
      hint: t('staffHint'),
      icon: <Settings aria-hidden size={20} className="text-muted flex-none" />,
    },
  };
  const items = [
    {
      href: ADMIN_PATHS.timetable,
      title: t('timetableLink'),
      hint: t('timetableHint'),
      icon: <CalendarDays aria-hidden size={20} className="text-muted flex-none" />,
    },
    ...settingsSections(session.user.roles).map((section) => links[section]),
  ];

  return (
    <AdminComingSoon section="more" icon={<Menu />}>
      <section
        aria-label={t('account')}
        className="bg-surface border-line flex flex-wrap items-center justify-between gap-3 rounded-lg border p-4"
      >
        <ShellUser name={name} meta={roles} initials={initials(name)} />
        <LogoutButton redirectTo={TENANT_PATHS.staffLogin} />
      </section>
      <ul className="m-0 flex list-none flex-col gap-3 p-0">
        {items.map((item) => (
          <li key={item.href}>
            <Link
              href={item.href}
              className="bg-surface border-line hover:border-brand flex min-h-11 items-center gap-3 rounded-lg border p-4"
            >
              {item.icon}
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="font-medium">{item.title}</span>
                <span className="text-muted text-sm">{item.hint}</span>
              </span>
              <ChevronRight aria-hidden size={18} className="text-muted flex-none" />
            </Link>
          </li>
        ))}
      </ul>
    </AdminComingSoon>
  );
}
