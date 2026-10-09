import { ShellUser } from '@remix/ui';
import {
  CalendarDays,
  ChevronRight,
  CreditCard,
  DoorOpen,
  Menu,
  MessageSquareText,
  Palette,
  ReceiptText,
  Settings,
} from 'lucide-react';
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
  const money = await getTranslations('settings');

  const links: Record<
    SettingsSection,
    { href: string; title: string; hint: string; icon: ReactNode }
  > = {
    payments: {
      href: ADMIN_PATHS.paymentsSettings,
      title: money('nav.payments'),
      hint: money('payments.subtitle'),
      icon: <CreditCard aria-hidden size={20} className="flex-none text-muted" />,
    },
    fees: {
      href: ADMIN_PATHS.feeSettings,
      title: money('nav.fees'),
      hint: money('fees.subtitle'),
      icon: <ReceiptText aria-hidden size={20} className="flex-none text-muted" />,
    },
    sms: {
      href: ADMIN_PATHS.smsSettings,
      title: money('nav.sms'),
      hint: money('sms.subtitle'),
      icon: <MessageSquareText aria-hidden size={20} className="flex-none text-muted" />,
    },
    general: {
      href: ADMIN_PATHS.settings,
      title: t('generalLink'),
      hint: t('generalHint'),
      icon: <Settings aria-hidden size={20} className="flex-none text-muted" />,
    },
    theme: {
      href: ADMIN_PATHS.theme,
      title: t('themeLink'),
      hint: t('themeHint'),
      icon: <Palette aria-hidden size={20} className="flex-none text-muted" />,
    },
    halls: {
      href: ADMIN_PATHS.halls,
      title: t('hallsLink'),
      hint: t('hallsHint'),
      icon: <DoorOpen aria-hidden size={20} className="flex-none text-muted" />,
    },
    staff: {
      href: ADMIN_PATHS.staff,
      title: t('staffLink'),
      hint: t('staffHint'),
      icon: <Settings aria-hidden size={20} className="flex-none text-muted" />,
    },
  };
  const items = [
    {
      href: ADMIN_PATHS.timetable,
      title: t('timetableLink'),
      hint: t('timetableHint'),
      icon: <CalendarDays aria-hidden size={20} className="flex-none text-muted" />,
    },
    ...settingsSections(session.user.roles).map((section) => links[section]),
  ];

  return (
    <AdminComingSoon section="more" icon={<Menu />}>
      <section
        aria-label={t('account')}
        className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line bg-surface p-4"
      >
        <ShellUser name={name} meta={roles} initials={initials(name)} />
        <LogoutButton redirectTo={TENANT_PATHS.staffLogin} />
      </section>
      <ul className="m-0 flex list-none flex-col gap-3 p-0">
        {items.map((item) => (
          <li key={item.href}>
            <Link
              href={item.href}
              className="flex min-h-11 items-center gap-3 rounded-lg border border-line bg-surface p-4 hover:border-brand"
            >
              {item.icon}
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="font-medium">{item.title}</span>
                <span className="text-sm text-muted">{item.hint}</span>
              </span>
              <ChevronRight aria-hidden size={18} className="flex-none text-muted" />
            </Link>
          </li>
        ))}
      </ul>
    </AdminComingSoon>
  );
}
