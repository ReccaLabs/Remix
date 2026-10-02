'use client';

import { buttonClass } from '@remix/ui';
import { useTranslations } from 'next-intl';
import { StatusPage } from './status-page';

/**
 * Body of every error boundary. Shows only the error digest (a hash Next.js also logs on the
 * server) — never the message or stack, which can contain internals.
 */
export function ErrorView({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  const t = useTranslations('errors.error');
  return (
    <StatusPage title={t('title')} body={t('body')}>
      <button type="button" onClick={() => retry()} className={buttonClass()}>
        {t('retry')}
      </button>
      {error.digest ? (
        <p className="text-muted m-0 font-mono text-xs">
          {t('reference', { digest: error.digest })}
        </p>
      ) : null}
    </StatusPage>
  );
}
