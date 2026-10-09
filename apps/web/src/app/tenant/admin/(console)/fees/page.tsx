import { getTranslations } from 'next-intl/server';
import type { ApiOutput } from '@remix/types/api';
import { IntlIsland } from '@/components/intl-island';
import { PaymentsPanel } from '@/components/fees/payments-panel';
import { CashCounter } from '@/components/fees/cash-counter';
import { SlipQueue } from '@/components/fees/slip-queue';
import { LoadError } from '@/components/portal/load-error';
import { PageBody, PageTitle } from '@/components/shell/page-body';
import { paymentsQuery } from '@/lib/fees-query';
import { getApi, requireStaff } from '@/server/api';
import { adminMetadata } from '@/server/metadata';

export const generateMetadata = () => adminMetadata('fees');

export default async function FeesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [session, params, t] = await Promise.all([requireStaff(['owner', 'admin', 'cashier']), searchParams, getTranslations('fees')]);
  const query = paymentsQuery(params);
  const cash = params.tab === 'cash';
  const slips = params.tab === 'slips';
  let initial: ApiOutput<'listPayments'> | null = null;
  let queue: ApiOutput<'listSlips'> | null = null;
  if (slips) try { queue = await (await getApi()).call('listSlips', { query: { status: 'submitted', page: 1, pageSize: 100 } }); } catch { /* Retry link below. */ }
  else if (!cash) try { initial = await (await getApi()).call('listPayments', { query }); } catch { /* Display a retry in the existing shell. */ }
  const tabs = [
    { href: '/admin/fees', label: t('payments'), active: !cash && !slips },
    { href: '/admin/fees?tab=slips', label: t('slips.queueTab'), active: slips },
    { href: '/admin/fees?tab=cash', label: t('cashCounter'), active: cash },
  ];
  return <PageBody width="admin">
    <PageTitle title={t('title')} subtitle={t('subtitle')} />
    <nav aria-label={t('tabs')} className="flex overflow-x-auto border-b border-line">{tabs.map(tab => <a key={tab.href} href={tab.href} aria-current={tab.active ? 'page' : undefined} className={`inline-flex min-h-11 shrink-0 items-center border-b-2 px-4 font-semibold ${tab.active ? 'border-brand text-brand' : 'border-transparent text-muted'}`}>{tab.label}</a>)}</nav>
    {slips && !queue ? <LoadError retryHref="/admin/fees?tab=slips" /> : <IntlIsland namespaces={['fees']}>{cash ? <CashCounter /> : slips && queue ? <SlipQueue initial={queue.items} /> : <PaymentsPanel initial={initial} query={query} owner={session.user.roles.includes('owner')} />}</IntlIsland>}
  </PageBody>;
}
