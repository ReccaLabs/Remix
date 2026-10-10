import { Skeleton } from '@remix/ui';
import { getTranslations } from 'next-intl/server';
import { PageBody } from '@/components/shell/page-body';

/** Loading state for the Fees tabs: title, tab bar and a table, as shapes with a spoken label. */
export default async function Loading() {
  const t = await getTranslations('fees');
  return (
    <PageBody width="admin">
      <div aria-busy="true" className="flex flex-col gap-5">
        <span className="sr-only" role="status">
          {t('loadingFees')}
        </span>
        <div className="flex flex-col gap-2">
          <Skeleton className="h-7 w-48" />
          <Skeleton shape="text" className="w-40" />
        </div>
        <div className="border-line flex gap-4 border-b py-3">
          <Skeleton shape="text" className="w-20" />
          <Skeleton shape="text" className="w-20" />
          <Skeleton shape="text" className="w-24" />
          <Skeleton shape="text" className="w-24" />
        </div>
        <div className="bg-surface border-line flex flex-col gap-3 rounded-lg border p-4">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} shape="text" className="w-full" />
          ))}
        </div>
      </div>
    </PageBody>
  );
}
