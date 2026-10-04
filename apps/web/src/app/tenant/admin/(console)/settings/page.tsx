import { can } from '@remix/types';
import { buttonClass, EmptyState } from '@remix/ui';
import { CircleAlert } from 'lucide-react';
import { notFound, redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { PeopleIsland } from '@/components/people/people-island';
import { PageBody, PageTitle } from '@/components/shell/page-body';
import { GeneralForm } from '@/components/settings/general-form';
import { SettingsNav, settingsHome } from '@/components/settings/settings-nav';
import { ADMIN_PATHS } from '@/lib/paths';
import { requireStaff } from '@/server/api';
import { loadGeneral, settingsMetadata } from '@/server/settings';

/**
 * Settings → General: institute name and default language. Owners only (`settings.manage`).
 * Other staff who can open some settings page (admins: Halls) are sent there; everyone else gets
 * the 404 page, so their role never reveals what exists.
 */

export const generateMetadata = () => settingsMetadata('general');

export default async function GeneralSettingsPage() {
  const session = await requireStaff();
  const roles = session.user.roles;
  if (!can(roles, 'settings.manage')) {
    const home = settingsHome(roles);
    if (home && home !== ADMIN_PATHS.settings) redirect(home);
    notFound();
  }
  const [result, t] = await Promise.all([loadGeneral(), getTranslations('settings')]);

  return (
    <PageBody width="admin">
      <PageTitle title={t('title')} subtitle={t('general.subtitle')} />
      <SettingsNav roles={roles} current="general" />
      {result.ok ? (
        <PeopleIsland namespaces={['settings']}>
          <GeneralForm initial={result.data} />
        </PeopleIsland>
      ) : (
        <EmptyState
          className="bg-surface border-line rounded-lg border"
          icon={<CircleAlert />}
          title={t('loadError.title')}
          description={t('loadError.body')}
          action={
            <a href={ADMIN_PATHS.settings} className={buttonClass({ variant: 'secondary' })}>
              {t('loadError.retry')}
            </a>
          }
        />
      )}
    </PageBody>
  );
}
