import { buttonClass, EmptyState } from '@remix/ui';
import { CircleAlert } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { PeopleIsland } from '@/components/people/people-island';
import { PageBody, PageTitle } from '@/components/shell/page-body';
import { PaymentsForm } from '@/components/settings/payments-form';
import { SettingsNav } from '@/components/settings/settings-nav';
import { ADMIN_PATHS } from '@/lib/paths';
import { requireStaff } from '@/server/api';
import { loadPayhere, settingsMetadata } from '@/server/settings';
export const generateMetadata = () => settingsMetadata('payments');
export default async function PaymentsSettingsPage() {
  const session = await requireStaff(['owner']);
  const [result, t] = await Promise.all([loadPayhere(), getTranslations('settings')]);
  return (
    <PageBody width="admin">
      <PageTitle title={t('title')} subtitle={t('payments.subtitle')} />
      <SettingsNav roles={session.user.roles} current="payments" />
      {result.ok ? (
        <PeopleIsland namespaces={['settings']}>
          <PaymentsForm initial={result.data} />
        </PeopleIsland>
      ) : (
        <EmptyState
          icon={<CircleAlert />}
          title={t('loadError.title')}
          description={t('loadError.body')}
          action={
            <a
              href={ADMIN_PATHS.paymentsSettings}
              className={buttonClass({ variant: 'secondary' })}
            >
              {t('loadError.retry')}
            </a>
          }
        />
      )}
    </PageBody>
  );
}
