'use client';

import {
  Button,
  Checkbox,
  DataTable,
  Field,
  StatusBadge,
  type DataTableColumn,
  type StatusTone,
} from '@remix/ui';
import type { ImportPreviewResponse, ImportRow, ImportRowResult } from '@remix/types/api';
import {
  ArrowLeft,
  Check,
  CircleAlert,
  Copy,
  Download,
  LoaderCircle,
  TriangleAlert,
} from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { useState, type ReactNode } from 'react';
import { FormAlert } from '@/components/form-alert';
import { Select } from '@/components/people/select';
import { currentMonth, monthDate, monthOptions, type ActionError } from '@/lib/people';
import { useResultText } from './use-result-text';

export interface ImportOptions {
  enrolFrom: string;
  sendWelcomeSms: boolean;
}

const PAGE = 50;

const TONE: Record<ImportRowResult['status'], StatusTone> = {
  ok: 'success',
  error: 'danger',
  duplicate: 'warning',
};

interface Line {
  rowNo: number;
  name: string;
  phone: string;
  result: ImportRowResult;
}

/**
 * Step 3 (STU-04): the dry run. Every row shows its result as a word and a colour; rows that
 * need attention come first in the filter, can be downloaded as a CSV, and are left out of the
 * import. Nothing is written until "Import N students".
 */
export function ReviewStep({
  rows,
  preview,
  failure,
  commitFailure,
  hasClasses,
  options,
  onOptions,
  committing,
  onBack,
  onDownload,
  onCommit,
}: {
  rows: readonly ImportRow[];
  /** null while the check runs. */
  preview: ImportPreviewResponse | null;
  failure: ActionError | null;
  /** The import could not be queued. */
  commitFailure: ActionError | null;
  hasClasses: boolean;
  options: ImportOptions;
  onOptions: (options: ImportOptions) => void;
  committing: boolean;
  onBack: () => void;
  onDownload: () => void;
  onCommit: () => void;
}) {
  const t = useTranslations('import.review');
  const tErrors = useTranslations('import.errors');
  const tStatus = useTranslations('import.review.status');
  const format = useFormatter();
  const describe = useResultText();
  const [onlyProblems, setOnlyProblems] = useState(true);
  const [limit, setLimit] = useState(PAGE);

  if (failure) {
    return (
      <section aria-labelledby="review-title" className="flex flex-col gap-4">
        <h2 id="review-title" className="m-0 text-lg font-semibold">
          {t('title')}
        </h2>
        <FormAlert>{`${t('loadError')} ${tErrors(failure)}`}</FormAlert>
        <div>
          <Button variant="secondary" size="lg" onClick={onBack}>
            <ArrowLeft aria-hidden size={18} />
            {t('back')}
          </Button>
        </div>
      </section>
    );
  }

  if (!preview) {
    return (
      <section aria-labelledby="review-title" className="flex flex-col gap-4">
        <h2 id="review-title" className="m-0 text-lg font-semibold">
          {t('title')}
        </h2>
        <p role="status" className="text-ink-2 m-0 flex items-center gap-2">
          <LoaderCircle aria-hidden size={18} className="animate-spin" />
          {t('checking', { count: rows.length })}
        </p>
      </section>
    );
  }

  const { summary } = preview;
  const problems = summary.errors + summary.duplicates;
  const lines: Line[] = preview.rows.map((result) => ({
    rowNo: result.rowNo,
    name: rows[result.rowNo - 1]?.displayName ?? '',
    phone: rows[result.rowNo - 1]?.phone ?? '',
    result,
  }));
  // With no problems the filter would hide nothing useful: show everything.
  const filtering = onlyProblems && problems > 0;
  const shown = (filtering ? lines.filter((l) => l.result.status !== 'ok') : lines).slice(0, limit);
  const total = filtering ? problems : lines.length;

  const columns: DataTableColumn<Line>[] = [
    { id: 'row', header: t('columns.row'), cell: (l) => l.rowNo, align: 'end' },
    { id: 'name', header: t('columns.name'), cell: (l) => l.name || t('noName'), rowHeader: true },
    { id: 'phone', header: t('columns.phone'), cell: (l) => l.phone },
    {
      id: 'status',
      header: t('columns.status'),
      cell: (l) => (
        <StatusBadge
          tone={TONE[l.result.status]}
          icon={
            l.result.status === 'ok' ? (
              <Check size={12} />
            ) : l.result.status === 'error' ? (
              <CircleAlert size={12} />
            ) : (
              <Copy size={12} />
            )
          }
        >
          {tStatus(l.result.status)}
        </StatusBadge>
      ),
    },
    {
      id: 'problems',
      header: t('columns.problems'),
      cell: (l) => describe(l.result),
      wrap: true,
      className: 'min-w-64',
    },
  ];

  const months = monthOptions(currentMonth(), 12);

  return (
    <section aria-labelledby="review-title" className="flex flex-col gap-5">
      <div>
        <h2 id="review-title" className="m-0 text-lg font-semibold">
          {t('title')}
        </h2>
        <p className="text-muted m-0 mt-1 max-w-prose">{t('intro')}</p>
      </div>

      <dl aria-label={t('summaryLabel')} className="m-0 grid gap-3 sm:grid-cols-3">
        <Tile
          tone="success"
          icon={<Check aria-hidden size={18} />}
          label={t('ready')}
          value={summary.ok}
          of={t('of', { total: summary.total })}
        />
        <Tile
          tone="danger"
          icon={<CircleAlert aria-hidden size={18} />}
          label={t('errors')}
          value={summary.errors}
          of={t('of', { total: summary.total })}
        />
        <Tile
          tone="warning"
          icon={<TriangleAlert aria-hidden size={18} />}
          label={t('duplicates')}
          value={summary.duplicates}
          of={t('of', { total: summary.total })}
        />
      </dl>

      <p role="status" className="m-0 font-medium">
        {summary.ok === 0 ? t('noneReady') : problems === 0 ? t('allGood') : null}
      </p>

      <div className="flex flex-col gap-3">
        {problems > 0 ? (
          <Checkbox
            label={t('filterProblems')}
            checked={onlyProblems}
            onChange={(event) => {
              setOnlyProblems(event.currentTarget.checked);
              setLimit(PAGE);
            }}
          />
        ) : null}
        <DataTable
          columns={columns}
          rows={shown}
          rowKey={(l) => String(l.rowNo)}
          caption={t('tableCaption')}
        />
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-muted m-0 text-sm">{t('showing', { shown: shown.length, total })}</p>
          {shown.length < total ? (
            <Button
              variant="secondary"
              size="lg"
              onClick={() => {
                setLimit((n) => n + PAGE);
              }}
            >
              {t('showMore')}
            </Button>
          ) : null}
        </div>
      </div>

      <fieldset className="border-line bg-surface m-0 flex flex-col gap-3 rounded-lg border p-4">
        <legend className="px-1 text-sm font-semibold">{t('options')}</legend>
        <Checkbox
          label={t('welcomeSms')}
          hint={t('welcomeSmsHint')}
          checked={options.sendWelcomeSms}
          onChange={(event) => {
            onOptions({ ...options, sendWelcomeSms: event.currentTarget.checked });
          }}
        />
        {hasClasses ? (
          <Field label={t('enrolFrom')} hint={t('enrolFromHint')} className="max-w-xs">
            <Select
              value={options.enrolFrom}
              onChange={(event) => {
                onOptions({ ...options, enrolFrom: event.currentTarget.value });
              }}
            >
              {months.map((m) => (
                <option key={m} value={m}>
                  {format.dateTime(monthDate(m), { month: 'long', year: 'numeric' })}
                </option>
              ))}
            </Select>
          </Field>
        ) : null}
      </fieldset>

      {commitFailure ? <FormAlert>{tErrors(commitFailure)}</FormAlert> : null}

      <div className="flex flex-wrap justify-between gap-3">
        <div className="flex flex-wrap gap-3">
          <Button variant="secondary" size="lg" onClick={onBack}>
            <ArrowLeft aria-hidden size={18} />
            {t('back')}
          </Button>
          {problems > 0 ? (
            <Button variant="secondary" size="lg" onClick={onDownload}>
              <Download aria-hidden size={18} />
              {t('downloadErrors')}
            </Button>
          ) : null}
        </div>
        <Button size="lg" disabled={summary.ok === 0} loading={committing} onClick={onCommit}>
          {t('import', { count: summary.ok })}
        </Button>
      </div>
    </section>
  );
}

const TILE: Record<StatusTone, string> = {
  success: 'border-success bg-success-soft text-success-ink',
  danger: 'border-danger bg-danger-soft text-danger-ink',
  warning: 'border-warning bg-warning-soft text-warning-ink',
  info: 'border-info bg-info-soft text-info-ink',
  neutral: 'border-line bg-surface text-ink',
};

function Tile({
  tone,
  icon,
  label,
  value,
  of,
}: {
  tone: StatusTone;
  icon: ReactNode;
  label: string;
  value: number;
  of: string;
}) {
  const format = useFormatter();
  return (
    <div className={`flex flex-col gap-1 rounded-lg border px-4 py-3 ${TILE[tone]}`}>
      <dt className="flex items-center gap-2 text-sm font-semibold">
        {icon}
        {label}
      </dt>
      <dd className="m-0 text-2xl font-semibold tabular-nums">{format.number(value)}</dd>
      <dd className="m-0 text-xs">{of}</dd>
    </div>
  );
}
