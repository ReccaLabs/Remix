import { buttonClass, EmptyState } from '@remix/ui';
import { CircleAlert } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { PeopleIsland } from '@/components/people/people-island';
import { PageBody, PageTitle } from '@/components/shell/page-body';
import { FeeSettingsForm } from '@/components/settings/fee-settings-form';
import { SettingsNav } from '@/components/settings/settings-nav';
import { ADMIN_PATHS } from '@/lib/paths';
import { requireStaff } from '@/server/api';
import { loadFees, settingsMetadata } from '@/server/settings';
export const generateMetadata = () => settingsMetadata('fees');
export default async function FeeSettingsPage() {
  const session = await requireStaff(['owner']);
  const [result, t] = await Promise.all([loadFees(), getTranslations('settings')]);
  return (
    <PageBody width="admin">
      <PageTitle title={t('title')} subtitle={t('fees.subtitle')} />
      <SettingsNav roles={session.user.roles} current="fees" />
      {result.ok ? (
        <PeopleIsland namespaces={['settings']}>
          <FeeSettingsForm initial={result.data} />
        </PeopleIsland>
      ) : (
        <EmptyState
          icon={<CircleAlert />}
          title={t('loadError.title')}
          description={t('loadError.body')}
          action={
            <a href={ADMIN_PATHS.feeSettings} className={buttonClass({ variant: 'secondary' })}>
              {t('loadError.retry')}
            </a>
          }
        />
      )}
    </PageBody>
  );
}
