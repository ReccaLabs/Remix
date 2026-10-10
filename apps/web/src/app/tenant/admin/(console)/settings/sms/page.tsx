import { buttonClass, EmptyState } from '@remix/ui';
import { CircleAlert } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { PeopleIsland } from '@/components/people/people-island';
import { PageBody, PageTitle } from '@/components/shell/page-body';
import { SettingsNav } from '@/components/settings/settings-nav';
import { SmsWalletCard } from '@/components/settings/sms-wallet-card';
import { ADMIN_PATHS } from '@/lib/paths';
import { requireStaff } from '@/server/api';
import { loadSmsWallet, settingsMetadata } from '@/server/settings';

export const generateMetadata = () => settingsMetadata('sms');

export default async function SmsSettingsPage() {
  const session = await requireStaff(['owner']);
  const [result, t] = await Promise.all([loadSmsWallet(), getTranslations('settings')]);
  return (
    <PageBody width="admin">
      <PageTitle title={t('title')} subtitle={t('sms.subtitle')} />
      <SettingsNav roles={session.user.roles} current="sms" />
      {result.ok ? (
        <PeopleIsland namespaces={['settings']}>
          <SmsWalletCard initial={result.data} />
        </PeopleIsland>
      ) : (
        <EmptyState
          icon={<CircleAlert />}
          title={t('loadError.title')}
          description={t('loadError.body')}
          action={
            <a href={ADMIN_PATHS.smsSettings} className={buttonClass({ variant: 'secondary' })}>
              {t('loadError.retry')}
            </a>
          }
        />
      )}
    </PageBody>
  );
}
