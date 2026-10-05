import { Skeleton } from '@remix/ui';
import { getTranslations } from 'next-intl/server';
export default async function ReceiptLoading() {
  const t = await getTranslations('settings.receiptPrint');
  return (
    <main
      id="main"
      className="mx-auto flex max-w-xs flex-col gap-4 p-4"
      role="status"
      aria-label={t('loading')}
    >
      <Skeleton className="h-8 w-full" />
      <Skeleton className="h-64 w-full" />
    </main>
  );
}
