import { getTranslations } from 'next-intl/server';
import type { ApiOutput } from '@remix/types/api';
import { IntlIsland } from '@/components/intl-island';
import { PaymentsPanel } from '@/components/fees/payments-panel';
import { PageBody, PageTitle } from '@/components/shell/page-body';
import { paymentsQuery } from '@/lib/fees-query';
import { getApi, requireStaff } from '@/server/api';
import { adminMetadata } from '@/server/metadata';

export const generateMetadata = () => adminMetadata('fees');

export default async function FeesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [session, params, t] = await Promise.all([requireStaff(['owner', 'admin', 'cashier']), searchParams, getTranslations('fees')]);
  const query = paymentsQuery(params);
  let initial: ApiOutput<'listPayments'> | null = null;
  try { initial = await (await getApi()).call('listPayments', { query }); } catch { /* Display a retry in the existing shell. */ }
  return <PageBody width="admin">
    <PageTitle title={t('title')} subtitle={t('subtitle')} />
    <nav aria-label={t('tabs')} className="border-b border-line"><a href="/admin/fees" aria-current="page" className="inline-flex min-h-11 items-center border-b-2 border-brand px-4 font-semibold text-brand">{t('payments')}</a></nav>
    <IntlIsland namespaces={['fees']}><PaymentsPanel initial={initial} query={query} owner={session.user.roles.includes('owner')} /></IntlIsland>
  </PageBody>;
}
