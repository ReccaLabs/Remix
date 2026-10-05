import { can } from '@remix/types';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { IntlIsland } from '@/components/intl-island';
import { PageBody, PageTitle } from '@/components/shell/page-body';
import { OrderedCards } from '@/components/students/ordered-cards';
import { getApi, requireStaff } from '@/server/api';

export const generateMetadata = async () => ({
  title: (await getTranslations('students.cards'))('pageTitle'),
});
export default async function CardsPage() {
  const session = await requireStaff();
  if (!can(session.user.roles, 'students.read')) notFound();
  const t = await getTranslations('students.cards');
  let orders;
  try {
    orders = await (await getApi()).call('listOrderedCards');
  } catch {
    return (
      <PageBody width="admin">
        <PageTitle title={t('pageTitle')} />
        <p role="alert">{t('loadError')}</p>
      </PageBody>
    );
  }
  return (
    <PageBody width="admin">
      <PageTitle title={t('pageTitle')} subtitle={t('printing')} />
      <IntlIsland namespaces={['students']}>
        <OrderedCards cards={orders.items} />
      </IntlIsland>
    </PageBody>
  );
}
