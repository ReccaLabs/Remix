'use client';
import { Button, DataTable, EmptyState, Field, Input, buttonClass } from '@remix/ui';
import { PAYMENT_METHODS, type ApiOutput, type ListPaymentsQuery } from '@remix/types/api';
import { formatLKR } from '@remix/types/money';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useFormatter, useTranslations } from 'next-intl';
import { useState } from 'react';
import { Select } from '@/components/people/select';
import { paymentsHref } from '@/lib/fees-query';
import { FeeError } from './fee-error';
import { PaymentDrawer } from './payment-drawer';
import { PaymentStatus } from './payment-status';

export function PaymentsPanel({ initial, query, owner }: { initial: ApiOutput<'listPayments'> | null; query: ListPaymentsQuery; owner: boolean }) {
  const t = useTranslations('fees'); const format = useFormatter(); const router = useRouter();
  const [detail, setDetail] = useState<string | null>(null);
  const page = initial?.page ?? 1; const pages = Math.max(1, Math.ceil((initial?.total ?? 0) / (initial?.pageSize ?? 25)));
  return <div className="flex flex-col gap-5">
    <form action="/admin/fees" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5" aria-label={t('filters')}>
      <Field label={t('from')}><Input name="from" type="date" defaultValue={query.from} /></Field>
      <Field label={t('to')}><Input name="to" type="date" defaultValue={query.to} /></Field>
      <Field label={t('method')}><Select name="method" defaultValue={query.method ?? ''}><option value="">{t('allMethods')}</option>{PAYMENT_METHODS.map(m => <option key={m} value={m}>{t(`methods.${m}`)}</option>)}</Select></Field>
      <Field label={t('studentFilter')}><Input name="studentId" defaultValue={query.studentId} placeholder={t('allStudents')} /></Field>
      <Field label={t('refund')}><Select name="needsRefund" defaultValue={query.needsRefund ?? ''}><option value="">{t('anyRefund')}</option><option value="true">{t('refundYes')}</option><option value="false">{t('refundNo')}</option></Select></Field>
      <div className="flex flex-wrap items-end gap-2 sm:col-span-2 xl:col-span-5"><Button size="lg" type="submit" variant="secondary">{t('apply')}</Button><a href="/admin/fees" className={buttonClass({ size: 'lg', variant: 'ghost' })}>{t('clear')}</a></div>
    </form>
    <FeeError failure={initial === null ? 'load' : null} />
    {initial === null ? <a href={paymentsHref(query)} className={buttonClass({ size: 'lg', variant: 'secondary' })}>{t('retry')}</a> : <>
      <div className="overflow-hidden rounded-lg border border-line bg-surface">
        <DataTable caption={t('payments')} rows={initial.items} rowKey={p => p.id} onRowActivate={p => setDetail(p.id)} columns={[
          { id: 'date', header: t('date'), cell: p => format.dateTime(new Date(p.receivedAt), { dateStyle: 'medium', timeZone: 'Asia/Colombo' }) },
          { id: 'student', header: t('student'), rowHeader: true, cell: p => p.studentName },
          { id: 'for', header: t('for'), wrap: true, className: 'min-w-64', cell: p => p.lines.map(l => `${l.className} · ${format.dateTime(new Date(l.month), { month: 'short', year: 'numeric' })}`).join(', ') },
          { id: 'method', header: t('method'), cell: p => t(`methods.${p.method}`) },
          { id: 'amount', header: t('amount'), align: 'end', cell: p => formatLKR(p.amountCents, { exact: true }) },
          { id: 'status', header: t('status'), cell: p => <PaymentStatus payment={p} /> },
        ]} empty={<EmptyState size="compact" title={t('empty')} description={t(query.from || query.to || query.method || query.studentId || query.needsRefund ? 'emptyFiltered' : 'emptyBody')} />} />
      </div>
      <nav aria-label={t('pagination')} className="flex flex-wrap items-center justify-between gap-3 text-sm">
        <p className="m-0 text-muted">{t('page', { page, pages, total: initial.total })}</p>
        <div className="flex gap-2">{page > 1 ? <a href={paymentsHref({ ...query, page: page - 1 })} className={buttonClass({ size: 'lg', variant: 'secondary' })}><ChevronLeft aria-hidden size={16} />{t('previous')}</a> : null}{page < pages ? <a href={paymentsHref({ ...query, page: page + 1 })} className={buttonClass({ size: 'lg', variant: 'secondary' })}>{t('next')}<ChevronRight aria-hidden size={16} /></a> : null}</div>
      </nav>
    </>}
    <PaymentDrawer key={detail ?? 'closed'} id={detail} owner={owner} onClose={() => setDetail(null)} onChanged={() => router.refresh()} />
  </div>;
}
