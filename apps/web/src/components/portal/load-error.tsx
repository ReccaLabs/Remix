import { buttonClass } from '@remix/ui';
import { CircleAlert } from 'lucide-react';
import { getTranslations } from 'next-intl/server';

/**
 * In-page error when the classes can't be loaded: what happened + one action. "Try again" is a
 * plain link to the same page, so it works even if client JavaScript failed to load.
 */
export async function LoadError({ retryHref }: { retryHref: string }) {
  const t = await getTranslations('portal.loadError');
  return (
    <div
      role="alert"
      className="bg-surface border-line flex flex-col items-center gap-3 rounded-lg border px-6 py-10 text-center"
    >
      <span
        aria-hidden
        className="bg-danger-soft text-danger-ink flex size-12 items-center justify-center rounded-xl"
      >
        <CircleAlert size={24} />
      </span>
      <div className="flex max-w-sm flex-col gap-1">
        <h2 className="m-0 text-base font-semibold">{t('title')}</h2>
        <p className="text-muted m-0 text-sm">{t('body')}</p>
      </div>
      <a href={retryHref} className={buttonClass({ variant: 'secondary', size: 'lg' })}>
        {t('retry')}
      </a>
    </div>
  );
}
