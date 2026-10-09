import { can } from '@remix/types';
import { getTranslations } from 'next-intl/server';
import type { ApiOutput } from '@remix/types/api';
import { IntlIsland } from '@/components/intl-island';
import { PaymentsPanel } from '@/components/fees/payments-panel';
import { CashCounter } from '@/components/fees/cash-counter';
import { InvoicesPanel } from '@/components/fees/invoices-panel';
import { PageBody, PageTitle } from '@/components/shell/page-body';
import { feeBusinessDate } from '@/lib/fees-money';
import { invoicesQuery, recentMonths } from '@/lib/invoices-query';
import { ADMIN_PATHS } from '@/lib/paths';
import { paymentsQuery } from '@/lib/fees-query';
import { getApi, requireStaff } from '@/server/api';
import { adminMetadata } from '@/server/metadata';

export const generateMetadata = () => adminMetadata('fees');

export default async function FeesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [session, params, t] = await Promise.all([requireStaff(['owner', 'admin', 'cashier']), searchParams, getTranslations('fees')]);
  const tab = params.tab === 'cash' ? 'cash' : params.tab === 'invoices' ? 'invoices' : 'payments';
  const roles = session.user.roles;
  const tabs = [
    { href: '/admin/fees', label: 'payments' as const, active: tab === 'payments' },
    { href: '/admin/fees?tab=invoices', label: 'invoicesTab' as const, active: tab === 'invoices' },
    { href: '/admin/fees?tab=cash', label: 'cashCounter' as const, active: tab === 'cash' },
  ];
  let body;
  if (tab === 'cash') body = <CashCounter />;
  else if (tab === 'invoices') {
    const query = invoicesQuery(params);
    const api = await getApi();
    let initial: ApiOutput<'listInvoices'> | null = null;
    let classes: { id: string; name: string }[] = [];
    try { initial = await api.call('listInvoices', { query }); } catch { /* Display a retry in the existing shell. */ }
    try { classes = (await api.call('listClasses', { query: {} })).items.map(c => ({ id: c.id, name: c.name })); } catch { /* The class filter just stays empty. */ }
    body = <InvoicesPanel initial={initial} query={query} classes={classes} months={recentMonths(`${feeBusinessDate().slice(0, 7)}-01`)}
      canRemind={can(roles, 'sms.send')} smsSettingsHref={can(roles, 'sms.wallet') ? ADMIN_PATHS.smsSettings : null} />;
  } else {
    const query = paymentsQuery(params);
    let initial: ApiOutput<'listPayments'> | null = null;
    try { initial = await (await getApi()).call('listPayments', { query }); } catch { /* Display a retry in the existing shell. */ }
    body = <PaymentsPanel initial={initial} query={query} owner={roles.includes('owner')} />;
  }
  return <PageBody width="admin">
    <PageTitle title={t('title')} subtitle={t('subtitle')} />
    <nav aria-label={t('tabs')} className="flex border-b border-line">{tabs.map(tab => <a key={tab.label} href={tab.href} aria-current={tab.active ? 'page' : undefined} className={`inline-flex min-h-11 items-center border-b-2 px-4 font-semibold ${tab.active ? 'border-brand text-brand' : 'border-transparent text-muted'}`}>{t(tab.label)}</a>)}</nav>
    <IntlIsland namespaces={['fees']}>{body}</IntlIsland>
  </PageBody>;
}
