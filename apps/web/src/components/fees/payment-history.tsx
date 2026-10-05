import { DataTable, EmptyState, buttonClass } from '@remix/ui';
import type { MyFeesResponse } from '@remix/types/api';
import { formatLKR } from '@remix/types/money';
import { Printer } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { PaymentStatus } from './payment-status';
import { ReceiptDownload } from './receipt-download';

export function PaymentHistory({ payments, admin = false }: { payments: MyFeesResponse['payments']; admin?: boolean }) {
  const t = useTranslations('fees'); const format = useFormatter();
  const date = (value: string) => format.dateTime(new Date(value), { dateStyle: 'medium', timeZone: 'Asia/Colombo' });
  const months = (p: MyFeesResponse['payments'][number]) => p.lines.map(l => `${l.className} · ${format.dateTime(new Date(l.month), { month: 'short', year: 'numeric' })}`).join(', ');
  const receipt = (receiptId: string | null) => receiptId ? <div className="flex flex-wrap gap-1"><ReceiptDownload id={receiptId} />{admin ? <a href={`/admin/receipts/${receiptId}/print`} target="_blank" rel="noopener noreferrer" className={buttonClass({ variant: 'ghost', size: 'lg' })}><Printer aria-hidden size={18} />{t('reprint')}</a> : null}</div> : null;
  return <section className="overflow-hidden rounded-lg border border-line bg-surface">
    <h2 className="m-0 border-b border-line px-4 py-3 text-base font-semibold">{t('history')}</h2>
    {payments.length === 0 ? <EmptyState size="compact" title={t('empty')} description={t('emptyBody')} /> : <>
      <ul className="m-0 list-none divide-y divide-line p-0 md:hidden">{payments.map(p => <li key={p.id} className="flex flex-col gap-3 p-4">
        <div className="flex items-start justify-between gap-3"><p className="m-0 font-semibold">{months(p)}</p><span className="shrink-0 font-semibold tabular-nums">{formatLKR(p.amountCents, { exact: true })}</span></div>
        <div className="flex flex-wrap items-center gap-2 text-sm"><span className="text-muted">{date(p.receivedAt)} · {t(`methods.${p.method}`)}</span><PaymentStatus payment={p} /></div>
        {receipt(p.receiptId)}
      </li>)}</ul>
      <div className="hidden md:block"><DataTable caption={t('history')} rows={payments} rowKey={p => p.id} columns={[
        { id: 'date', header: t('date'), rowHeader: true, cell: p => date(p.receivedAt) },
        { id: 'for', header: t('for'), wrap: true, className: 'min-w-64', cell: months },
        { id: 'method', header: t('method'), cell: p => t(`methods.${p.method}`) },
        { id: 'amount', header: t('amount'), align: 'end', cell: p => formatLKR(p.amountCents, { exact: true }) },
        { id: 'status', header: t('status'), cell: p => <PaymentStatus payment={p} /> },
        { id: 'receipt', header: t('receipt'), hideHeader: true, cell: p => receipt(p.receiptId) },
      ]} /></div>
    </>}
  </section>;
}
