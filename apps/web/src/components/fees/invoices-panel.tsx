'use client';
import { Button, DataTable, EmptyState, Field, Input, StatusBadge, buttonClass } from '@remix/ui';
import { INVOICE_FILTERS, type ApiOutput, type InvoiceStatus, type ListInvoicesQuery } from '@remix/types/api';
import { formatLKR } from '@remix/types/money';
import { ChevronLeft, ChevronRight, Download, MessageSquareText } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useFormatter, useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { Select } from '@/components/people/select';
import { createBrowserApi } from '@/lib/browser-api';
import { csvDocument } from '@/lib/csv';
import { downloadTextFile } from '@/lib/import/download';
import { invoicesHref } from '@/lib/invoices-query';
import { FeeError } from './fee-error';
import { ReminderDialog } from './reminder-dialog';

const TONE: Record<InvoiceStatus, 'success' | 'warning' | 'danger' | 'neutral'> = {
  paid: 'success',
  partially_paid: 'warning',
  overdue: 'danger',
  unpaid: 'neutral',
};
/** The whole filtered list is exported, a page at a time, up to this many pages. */
const EXPORT_PAGES = 100;

export interface InvoicesPanelProps {
  initial: ApiOutput<'listInvoices'> | null;
  query: ListInvoicesQuery;
  classes: readonly { id: string; name: string }[];
  /** Months for the filter and the reminder dialog (`YYYY-MM-01`, newest first). */
  months: readonly string[];
  /** Owner or admin: may text reminders (permission `sms.send`). */
  canRemind: boolean;
  /** Owner: the way to buy SMS when the wallet is short. */
  smsSettingsHref: string | null;
}

export function InvoicesPanel({ initial, query, classes, months, canRemind, smsSettingsHref }: InvoicesPanelProps) {
  const t = useTranslations('fees.invoices');
  const tf = useTranslations('fees');
  const format = useFormatter();
  const router = useRouter();
  const [remindOpen, setRemindOpen] = useState(false);
  const [unpaidCount, setUnpaidCount] = useState<number | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportFailed, setExportFailed] = useState(false);
  const month = query.month ?? months[0] ?? '';
  const filter = query.filter ?? 'all';
  const page = initial?.page ?? 1;
  const pages = Math.max(1, Math.ceil((initial?.total ?? 0) / (initial?.pageSize ?? 25)));
  const monthLabel = (value: string) => format.dateTime(new Date(value), { month: 'long', year: 'numeric', timeZone: 'Asia/Colombo' });

  // "Send reminder SMS to N unpaid": N is the same count the dialog's preview will show.
  useEffect(() => {
    if (!canRemind || !month) return undefined;
    let cancelled = false;
    createBrowserApi().api.call('previewReminders', { month, filter: 'unpaid', ...(query.classId ? { classId: query.classId } : {}) }).then(
      (result) => { if (!cancelled) setUnpaidCount(result.recipients); },
      () => { if (!cancelled) setUnpaidCount(null); },
    );
    return () => { cancelled = true; };
  }, [canRemind, month, query.classId]);

  async function exportCsv() {
    setExporting(true);
    setExportFailed(false);
    try {
      const { api } = createBrowserApi();
      const rows: ApiOutput<'listInvoices'>['items'] = [];
      for (let p = 1; p <= EXPORT_PAGES; p += 1) {
        const result = await api.call('listInvoices', { query: { ...query, page: p, pageSize: 100 } });
        rows.push(...result.items);
        if (rows.length >= result.total || result.items.length === 0) break;
      }
      const header = [t('number'), t('student'), t('month'), t('due'), t('total'), t('paid'), t('statusColumn')];
      const body = rows.map((r) => [r.number, `${r.studentName} (${r.studentNo})`, r.month.slice(0, 7), r.dueOn, (r.totalCents / 100).toFixed(2), (r.paidCents / 100).toFixed(2), t(`invoiceStatus.${r.status}`)]);
      downloadTextFile(`${t('exportName')}-${query.month?.slice(0, 7) ?? 'all'}.csv`, csvDocument(header, body));
    } catch {
      setExportFailed(true);
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <nav aria-label={t('statusNav')} className="flex flex-wrap gap-2">
        {INVOICE_FILTERS.map((f) => (
          <a
            key={f}
            href={invoicesHref({ ...query, filter: f, page: 1 })}
            aria-current={f === filter ? 'page' : undefined}
            className={`inline-flex min-h-11 items-center rounded-md border px-4 text-sm font-semibold ${f === filter ? 'border-brand bg-brand-soft text-brand' : 'border-line bg-surface text-ink-2 hover:border-line-strong'}`}
          >
            {t(`status.${f}`)}
          </a>
        ))}
      </nav>
      <form action="/admin/fees" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label={t('filters')}>
        <input type="hidden" name="tab" value="invoices" />
        {filter !== 'all' ? <input type="hidden" name="filter" value={filter} /> : null}
        <Field label={t('month')}>
          <Select name="month" defaultValue={query.month ?? ''}>
            <option value="">{t('allMonths')}</option>
            {months.map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}
          </Select>
        </Field>
        <Field label={t('class')}>
          <Select name="classId" defaultValue={query.classId ?? ''}>
            <option value="">{t('allClasses')}</option>
            {classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
        </Field>
        <Field label={t('search')}><Input name="q" defaultValue={query.q} placeholder={t('searchPlaceholder')} maxLength={80} /></Field>
        <div className="flex flex-wrap items-end gap-2">
          <Button size="lg" type="submit" variant="secondary">{tf('apply')}</Button>
          <a href="/admin/fees?tab=invoices" className={buttonClass({ size: 'lg', variant: 'ghost' })}>{tf('clear')}</a>
        </div>
      </form>
      <div className="flex flex-wrap items-center gap-2">
        {canRemind ? (
          <Button size="lg" type="button" onClick={() => setRemindOpen(true)}>
            <MessageSquareText aria-hidden size={16} />
            {unpaidCount === null ? t('remindPlain') : t('remind', { count: unpaidCount })}
          </Button>
        ) : null}
        <Button size="lg" type="button" variant="secondary" loading={exporting} disabled={initial === null || initial.total === 0} onClick={() => void exportCsv()}>
          <Download aria-hidden size={16} />
          {exporting ? t('exporting') : t('export')}
        </Button>
      </div>
      {exportFailed ? <p role="alert" className="m-0 text-danger-ink">{t('exportFailed')}</p> : null}
      <FeeError failure={initial === null ? 'load' : null} />
      {initial === null ? (
        <a href={invoicesHref(query)} className={buttonClass({ size: 'lg', variant: 'secondary' })}>{tf('retry')}</a>
      ) : (
        <>
          <p className="m-0 text-sm text-muted">
            {t('totals', { count: initial.total, paid: formatLKR(initial.totals.paidCents, { exact: true }), total: formatLKR(initial.totals.totalCents, { exact: true }) })}
          </p>
          <div className="overflow-hidden rounded-lg border border-line bg-surface">
            <DataTable
              caption={t('title')}
              rows={initial.items}
              rowKey={(r) => r.id}
              columns={[
                { id: 'number', header: t('number'), cell: (r) => r.number },
                { id: 'student', header: t('student'), rowHeader: true, cell: (r) => <span>{r.studentName}<span className="block text-xs text-muted">{r.studentNo}</span></span> },
                { id: 'month', header: t('month'), cell: (r) => monthLabel(r.month) },
                { id: 'due', header: t('due'), cell: (r) => format.dateTime(new Date(r.dueOn), { dateStyle: 'medium', timeZone: 'Asia/Colombo' }) },
                { id: 'total', header: t('total'), align: 'end', cell: (r) => formatLKR(r.totalCents, { exact: true }) },
                { id: 'paid', header: t('paid'), align: 'end', cell: (r) => formatLKR(r.paidCents, { exact: true }) },
                {
                  id: 'status',
                  header: t('statusColumn'),
                  cell: (r) => (
                    <span className="inline-flex flex-wrap gap-1">
                      <StatusBadge tone={TONE[r.status]}>{t(`invoiceStatus.${r.status}`)}</StatusBadge>
                      {r.slipWaiting ? <StatusBadge tone="info">{t('slipWaiting')}</StatusBadge> : null}
                    </span>
                  ),
                },
              ]}
              empty={<EmptyState size="compact" title={t('empty')} description={t(query.month || query.classId || query.q || filter !== 'all' ? 'emptyFiltered' : 'emptyBody')} />}
            />
          </div>
          <nav aria-label={tf('pagination')} className="flex flex-wrap items-center justify-between gap-3 text-sm">
            <p className="m-0 text-muted">{tf('page', { page, pages, total: initial.total })}</p>
            <div className="flex gap-2">
              {page > 1 ? <a href={invoicesHref({ ...query, page: page - 1 })} className={buttonClass({ size: 'lg', variant: 'secondary' })}><ChevronLeft aria-hidden size={16} />{tf('previous')}</a> : null}
              {page < pages ? <a href={invoicesHref({ ...query, page: page + 1 })} className={buttonClass({ size: 'lg', variant: 'secondary' })}>{tf('next')}<ChevronRight aria-hidden size={16} /></a> : null}
            </div>
          </nav>
        </>
      )}
      {canRemind ? (
        <ReminderDialog
          key={remindOpen ? 'open' : 'closed'}
          open={remindOpen}
          onClose={() => setRemindOpen(false)}
          months={months}
          classes={classes}
          defaultTarget={{ month, filter: filter === 'overdue' ? 'overdue' : 'unpaid', ...(query.classId ? { classId: query.classId } : {}) }}
          smsSettingsHref={smsSettingsHref}
          onSent={() => router.refresh()}
        />
      ) : null}
    </div>
  );
}
