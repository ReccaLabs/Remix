import { Skeleton } from '@remix/ui';
import { getTranslations } from 'next-intl/server';
import { PageBody } from './page-body';

/**
 * Loading state inside the portal/admin shells: a title bar and a few cards. Shapes only;
 * the region is `aria-busy` with a spoken "Loading" label.
 */
export async function ContentSkeleton({
  cards = 3,
  label,
  width = 'portal',
}: {
  cards?: number;
  /** Spoken label; defaults to "Loading". */
  label?: string;
  width?: 'portal' | 'admin';
}) {
  const t = await getTranslations('errors.loading');
  return (
    <PageBody width={width}>
      <div aria-busy="true" className="flex flex-col gap-6">
        <span className="sr-only" role="status">
          {label ?? t('label')}
        </span>
        <div className="flex flex-col gap-2">
          <Skeleton className="h-7 w-48" />
          <Skeleton shape="text" className="w-32" />
        </div>
        <div className="grid gap-3 md:grid-cols-2 lg:gap-5 xl:grid-cols-3">
          {Array.from({ length: cards }, (_, i) => (
            <div
              key={i}
              className="bg-surface border-line flex flex-col gap-3 rounded-lg border p-4"
            >
              <Skeleton className="h-5 w-3/4" />
              <Skeleton shape="text" className="w-1/2" />
              <div className="flex gap-3">
                <Skeleton shape="text" className="w-20" />
                <Skeleton shape="text" className="w-24" />
                <Skeleton shape="text" className="w-16" />
              </div>
              <Skeleton shape="text" className="mt-2 w-full" />
            </div>
          ))}
        </div>
      </div>
    </PageBody>
  );
}
