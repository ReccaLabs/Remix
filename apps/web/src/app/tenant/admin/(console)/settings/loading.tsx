import { Skeleton } from '@remix/ui';
import { getTranslations } from 'next-intl/server';
export default async function SettingsLoading() {
  const t = await getTranslations('settings');
  return (
    <div
      className="mx-auto flex w-full max-w-2xl flex-col gap-4 p-4"
      role="status"
      aria-label={t('loading')}
    >
      <Skeleton className="h-8 w-48" />
      {[1, 2, 3, 4].map((id) => (
        <Skeleton key={id} className="h-16 w-full" />
      ))}
    </div>
  );
}
