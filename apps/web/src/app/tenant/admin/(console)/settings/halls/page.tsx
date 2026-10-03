import { can } from '@remix/types';
import { buttonClass, EmptyState } from '@remix/ui';
import { CircleAlert } from 'lucide-react';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { PeopleIsland } from '@/components/people/people-island';
import { PageBody, PageTitle } from '@/components/shell/page-body';
import { HallsPanel } from '@/components/settings/halls-panel';
import { SettingsNav } from '@/components/settings/settings-nav';
import { ADMIN_PATHS } from '@/lib/paths';
import { requireStaff } from '@/server/api';
import { loadHalls } from '@/server/classes';
import { settingsMetadata } from '@/server/settings';

/** Settings → Halls (CLS-05). Owners and admins (`classes.write`); others get the 404 page. */

export const generateMetadata = () => settingsMetadata('halls');

export default async function HallsSettingsPage() {
  const session = await requireStaff();
  const roles = session.user.roles;
  if (!can(roles, 'classes.write')) notFound();
  const [result, t] = await Promise.all([loadHalls(), getTranslations('settings')]);

  return (
    <PageBody width="admin">
      <PageTitle title={t('title')} subtitle={t('halls.subtitle')} />
      <SettingsNav roles={roles} current="halls" />
      {result.ok ? (
        <PeopleIsland namespaces={['settings']}>
          <HallsPanel halls={result.data} canWrite />
        </PeopleIsland>
      ) : (
        <EmptyState
          className="bg-surface border-line rounded-lg border"
          icon={<CircleAlert />}
          title={t('loadError.title')}
          description={t('loadError.body')}
          action={
            <a href={ADMIN_PATHS.halls} className={buttonClass({ variant: 'secondary' })}>
              {t('loadError.retry')}
            </a>
          }
        />
      )}
    </PageBody>
  );
}
