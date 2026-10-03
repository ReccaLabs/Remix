import { can } from '@remix/types';
import type { StaffRole } from '@remix/types/api';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { ADMIN_PATHS } from '@/lib/paths';

export type SettingsSection = 'general' | 'theme' | 'halls' | 'staff';

const HREF: Record<SettingsSection, string> = {
  general: ADMIN_PATHS.settings,
  theme: ADMIN_PATHS.theme,
  halls: ADMIN_PATHS.halls,
  staff: ADMIN_PATHS.staff,
};

/** The settings pages a person with these roles may open, in menu order. */
export function settingsSections(roles: readonly StaffRole[]): SettingsSection[] {
  return [
    ...(can(roles, 'settings.manage') ? (['general', 'theme'] as const) : []),
    ...(can(roles, 'classes.write') ? (['halls'] as const) : []),
    ...(can(roles, 'staff.manage') ? (['staff'] as const) : []),
  ];
}

/** Where "Settings" in the menu leads: the first page this person may open, or null for none. */
export const settingsHome = (roles: readonly StaffRole[]): string | null => {
  const [first] = settingsSections(roles);
  return first ? HREF[first] : null;
};

/** Tab strip of the settings pages (links, so it works without JavaScript). */
export async function SettingsNav({
  roles,
  current,
}: {
  roles: readonly StaffRole[];
  current: SettingsSection;
}) {
  const t = await getTranslations('settings.nav');
  const sections = settingsSections(roles);
  if (sections.length < 2) return null;
  return (
    <nav aria-label={t('label')} className="border-line overflow-x-auto border-b">
      <ul className="m-0 flex min-w-max list-none gap-1 p-0">
        {sections.map((section) => (
          <li key={section}>
            <Link
              href={HREF[section]}
              aria-current={section === current ? 'page' : undefined}
              className={
                section === current
                  ? 'border-brand text-brand -mb-px inline-flex min-h-11 items-center border-b-2 px-3 text-sm font-semibold'
                  : 'text-muted hover:text-ink inline-flex min-h-11 items-center px-3 text-sm font-medium'
              }
            >
              {t(section)}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
