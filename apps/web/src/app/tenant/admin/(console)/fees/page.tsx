import { getTranslations } from 'next-intl/server';
import type { ApiOutput } from '@remix/types/api';
import { IntlIsland } from '@/components/intl-island';
import { PaymentsPanel } from '@/components/fees/payments-panel';
import { CashCounter } from '@/components/fees/cash-counter';
import { PageBody, PageTitle } from '@/components/shell/page-body';
import { paymentsQuery } from '@/lib/fees-query';
import { getApi, requireStaff } from '@/server/api';
import { adminMetadata } from '@/server/metadata';

export const generateMetadata = () => adminMetadata('fees');

export default async function FeesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [session, params, t] = await Promise.all([requireStaff(['owner', 'admin', 'cashier']), searchParams, getTranslations('fees')]);
  const query = paymentsQuery(params);
  const cash = params.tab === 'cash';
  let initial: ApiOutput<'listPayments'> | null = null;
  if (!cash) try { initial = await (await getApi()).call('listPayments', { query }); } catch { /* Display a retry in the existing shell. */ }
  return <PageBody width="admin">
    <PageTitle title={t('title')} subtitle={t('subtitle')} />
    <nav aria-label={t('tabs')} className="flex border-b border-line">{[{ href: '/admin/fees', label: 'payments' as const, active: !cash }, { href: '/admin/fees?tab=cash', label: 'cashCounter' as const, active: cash }].map(tab => <a key={tab.label} href={tab.href} aria-current={tab.active ? 'page' : undefined} className={`inline-flex min-h-11 items-center border-b-2 px-4 font-semibold ${tab.active ? 'border-brand text-brand' : 'border-transparent text-muted'}`}>{t(tab.label)}</a>)}</nav>
    <IntlIsland namespaces={['fees']}>{cash ? <CashCounter /> : <PaymentsPanel initial={initial} query={query} owner={session.user.roles.includes('owner')} />}</IntlIsland>
  </PageBody>;
}
