import { can } from '@remix/types';
import { getTranslations } from 'next-intl/server';
import type { ApiOutput } from '@remix/types/api';
import { PaymentsPanel } from '@/components/fees/payments-panel';
import { CashCounter } from '@/components/fees/cash-counter';
import { FeesTabs, type FeesTab } from '@/components/fees/fees-tabs';
import { InvoicesPanel } from '@/components/fees/invoices-panel';
import { SlipQueue } from '@/components/fees/slip-queue';
import { PeopleIsland } from '@/components/people/people-island';
import { LoadError } from '@/components/portal/load-error';
import { PageBody, PageTitle } from '@/components/shell/page-body';
import { feeBusinessDate } from '@/lib/fees-money';
import { allowedFeesTabs, FEES_TAB_HREF, resolveFeesTab } from '@/lib/fees-tabs';
import { invoicesQuery, recentMonths } from '@/lib/invoices-query';
import { ADMIN_PATHS } from '@/lib/paths';
import { paymentsQuery } from '@/lib/fees-query';
import { getApi, requireStaff } from '@/server/api';
import { adminMetadata } from '@/server/metadata';

export const generateMetadata = () => adminMetadata('fees');

export default async function FeesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [session, params, t] = await Promise.all([requireStaff(['owner', 'admin', 'cashier']), searchParams, getTranslations('fees')]);
  const roles = session.user.roles;
  const tab = resolveFeesTab(params.tab, roles);
  const api = await getApi();

  let body;
  let waiting: number | null = null;
  if (tab === 'cash') body = <CashCounter />;
  else if (tab === 'slips') {
    let queue: ApiOutput<'listSlips'> | null = null;
    try { queue = await api.call('listSlips', { query: { status: 'submitted', page: 1, pageSize: 100 } }); } catch { /* Retry link below. */ }
    waiting = queue?.total ?? null;
    body = queue ? <SlipQueue initial={queue.items} /> : null;
  } else if (tab === 'invoices') {
    const query = invoicesQuery(params);
    let initial: ApiOutput<'listInvoices'> | null = null;
    let classes: { id: string; name: string }[] = [];
    try { initial = await api.call('listInvoices', { query }); } catch { /* Display a retry in the existing shell. */ }
    try { classes = (await api.call('listClasses', { query: {} })).items.map(c => ({ id: c.id, name: c.name })); } catch { /* The class filter just stays empty. */ }
    body = <InvoicesPanel initial={initial} query={query} classes={classes} months={recentMonths(`${feeBusinessDate().slice(0, 7)}-01`)}
      canRemind={can(roles, 'sms.send')} smsSettingsHref={can(roles, 'sms.wallet') ? ADMIN_PATHS.smsSettings : null} />;
  } else {
    const query = paymentsQuery(params);
    let initial: ApiOutput<'listPayments'> | null = null;
    try { initial = await api.call('listPayments', { query }); } catch { /* Display a retry in the existing shell. */ }
    body = <PaymentsPanel initial={initial} query={query} owner={roles.includes('owner')} />;
  }

  // The count on the Bank slips tab is the number of slips waiting for review. The queue tab
  // already holds it; the other tabs ask for one row. A failed count just hides the number.
  if (waiting === null && tab !== 'slips') {
    try { waiting = (await api.call('listSlips', { query: { status: 'submitted', page: 1, pageSize: 1 } })).total; } catch { /* No count. */ }
  }

  const labels: Record<FeesTab['id'], string> = { payments: t('payments'), invoices: t('invoicesTab'), slips: t('slips.queueTab'), cash: t('cashCounter') };
  const tabs: FeesTab[] = allowedFeesTabs(roles).map(id => ({
    id, href: FEES_TAB_HREF[id], label: labels[id], active: id === tab,
    ...(id === 'slips' && waiting ? { count: waiting, countLabel: t('slips.tabWaiting') } : {}),
  }));
  return <PageBody width="admin">
    <PageTitle title={t('title')} subtitle={t('subtitle')} />
    <FeesTabs label={t('tabs')} tabs={tabs} />
    {body ? <PeopleIsland namespaces={['fees']}>{body}</PeopleIsland> : <LoadError retryHref={FEES_TAB_HREF[tab]} />}
  </PageBody>;
}
