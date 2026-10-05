import type { MyFeesResponse } from '@remix/types/api';
import { formatLKR } from '@remix/types/money';
import { Landmark } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { OpenMonths } from './open-months';
import { PaymentHistory } from './payment-history';

/** Read-only until 3-E implements checkout; the history is already usable for every method. */
export function PayOverview({ fees }: { fees: MyFeesResponse }) {
  const t = useTranslations('fees'); const total = fees.openLines.reduce((sum, l) => sum + l.openCents, 0);
  return <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
    <div className="min-w-0"><OpenMonths lines={fees.openLines} /></div>
    <aside className="flex min-w-0 flex-col gap-5">
      <section aria-label={t('total')} className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-5"><h2 className="m-0 text-base font-semibold">{t('total')}</h2><p className="m-0 text-2xl font-semibold tabular-nums">{formatLKR(total, { exact: true })}</p></section>
      {fees.bankDetails ? <section aria-labelledby="bank-details-title" className="flex flex-col gap-4 rounded-lg border border-line bg-surface p-5">
        <h2 id="bank-details-title" className="m-0 flex items-center gap-2 text-base font-semibold"><Landmark aria-hidden size={18} />{t('bankDetails')}</h2>
        <dl className="m-0 flex flex-col gap-3 text-sm">{(['bankName', 'branch', 'accountName', 'accountNumber'] as const).map(key => <div key={key}><dt className="text-muted">{t(key)}</dt><dd className="m-0 break-words font-medium">{fees.bankDetails?.[key]}</dd></div>)}</dl>
      </section> : null}
    </aside>
    <div className="min-w-0 lg:col-span-2"><PaymentHistory payments={fees.payments} /></div>
  </div>;
}
