'use client';

import { Button, buttonClass } from '@remix/ui';
import type { ImportJob } from '@remix/types/api';
import { CircleAlert, CircleCheck, Download, LoaderCircle } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { ADMIN_PATHS } from '@/lib/paths';

/** While the worker runs the job (STU-04). The API reports no per-row progress, so this is a busy state. */
export function RunningStep({
  count,
  status,
  slow,
}: {
  count: number;
  status: ImportJob['status'] | 'sending';
  slow: boolean;
}) {
  const t = useTranslations('import.running');
  return (
    <section aria-labelledby="running-title" className="flex flex-col gap-4">
      <h2 id="running-title" className="m-0 text-lg font-semibold">
        {t('title')}
      </h2>
      <div
        role="status"
        aria-label={t('label')}
        className="bg-surface border-line flex items-start gap-3 rounded-lg border p-4"
      >
        <LoaderCircle aria-hidden size={22} className="text-brand mt-0.5 flex-none animate-spin" />
        <div className="flex flex-col gap-1">
          <p className="m-0">{t('body', { count })}</p>
          <p className="text-muted m-0 text-sm">
            {status === 'running' ? t('working') : t('queued')}
          </p>
          {slow ? <p className="text-warning-ink m-0 text-sm font-medium">{t('slow')}</p> : null}
        </div>
      </div>
    </section>
  );
}

/** The outcome: counts, rows that were left out, and where to go next. */
export function DoneStep({
  job,
  onDownload,
  onAnother,
  onRetry,
}: {
  job: ImportJob;
  onDownload: () => void;
  onAnother: () => void;
  onRetry: () => void;
}) {
  const t = useTranslations('import.done');
  const tReview = useTranslations('import.review');

  if (job.status === 'failed') {
    return (
      <section aria-labelledby="done-title" className="flex flex-col gap-4">
        <h2 id="done-title" className="m-0 flex items-center gap-2 text-lg font-semibold">
          <CircleAlert aria-hidden size={22} className="text-danger" />
          {t('failedTitle')}
        </h2>
        <p role="alert" className="m-0 max-w-prose">
          {t('failedBody')}
        </p>
        <div>
          <Button size="lg" onClick={onRetry}>
            {t('tryAgain')}
          </Button>
        </div>
      </section>
    );
  }

  const skipped = (job.summary?.errors ?? 0) + (job.summary?.duplicates ?? 0);
  return (
    <section aria-labelledby="done-title" className="flex flex-col gap-4">
      <h2 id="done-title" className="m-0 flex items-center gap-2 text-lg font-semibold">
        <CircleCheck aria-hidden size={22} className="text-success" />
        {t('title')}
      </h2>
      <div role="status" className="flex flex-col gap-1">
        <p className="m-0 text-base font-medium">{t('created', { count: job.created ?? 0 })}</p>
        {job.enrolled ? (
          <p className="text-ink-2 m-0">{t('enrolled', { count: job.enrolled })}</p>
        ) : null}
        {skipped > 0 ? <p className="text-ink-2 m-0">{t('skipped', { count: skipped })}</p> : null}
      </div>
      <div className="flex flex-wrap gap-3">
        <Link
          href={ADMIN_PATHS.students}
          className={buttonClass({ variant: 'primary', size: 'lg' })}
        >
          {t('viewStudents')}
        </Link>
        {skipped > 0 ? (
          <Button variant="secondary" size="lg" onClick={onDownload}>
            <Download aria-hidden size={18} />
            {tReview('downloadErrors')}
          </Button>
        ) : null}
        <Button variant="secondary" size="lg" onClick={onAnother}>
          {t('another')}
        </Button>
      </div>
    </section>
  );
}
