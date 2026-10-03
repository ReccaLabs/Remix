import { can } from '@remix/types';
import { buttonClass, EmptyState } from '@remix/ui';
import { CircleAlert } from 'lucide-react';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { PeopleIsland } from '@/components/people/people-island';
import { PageBody, PageTitle } from '@/components/shell/page-body';
import { SettingsNav } from '@/components/settings/settings-nav';
import { ThemeForm } from '@/components/settings/theme-form';
import { ADMIN_PATHS } from '@/lib/paths';
import { requireStaff } from '@/server/api';
import { loadTheme, settingsMetadata } from '@/server/settings';

/** Settings → Theme (TEN-03): brand colour, logo and tab icon. Owners only (`settings.manage`). */

export const generateMetadata = () => settingsMetadata('theme');

export default async function ThemeSettingsPage() {
  const session = await requireStaff();
  if (!can(session.user.roles, 'settings.manage')) notFound();
  const [result, t] = await Promise.all([loadTheme(), getTranslations('settings')]);

  return (
    <PageBody width="admin">
      <PageTitle title={t('title')} subtitle={t('theme.subtitle')} />
      <SettingsNav roles={session.user.roles} current="theme" />
      {result.ok ? (
        <PeopleIsland namespaces={['settings']}>
          <ThemeForm initial={result.data} />
        </PeopleIsland>
      ) : (
        <EmptyState
          className="bg-surface border-line rounded-lg border"
          icon={<CircleAlert />}
          title={t('loadError.title')}
          description={t('loadError.body')}
          action={
            <a href={ADMIN_PATHS.theme} className={buttonClass({ variant: 'secondary' })}>
              {t('loadError.retry')}
            </a>
          }
        />
      )}
    </PageBody>
  );
}
