import { getTranslations } from 'next-intl/server';

/** Neutral loading placeholder (heading + a few lines). Shapes only; the label is for screen readers. */
export async function PageSkeleton() {
  const t = await getTranslations('errors.loading');
  return (
    <main id="main" aria-busy="true" className="mx-auto w-full max-w-3xl px-4 py-16 sm:px-6">
      <span className="sr-only" role="status">
        {t('label')}
      </span>
      <div aria-hidden className="flex animate-pulse flex-col gap-4">
        <div className="bg-line h-4 w-24 rounded-full" />
        <div className="bg-line h-9 w-3/4 rounded-md" />
        <div className="bg-line-soft h-4 w-full rounded-full" />
        <div className="bg-line-soft h-4 w-5/6 rounded-full" />
        <div className="bg-line-soft h-4 w-2/3 rounded-full" />
      </div>
    </main>
  );
}
