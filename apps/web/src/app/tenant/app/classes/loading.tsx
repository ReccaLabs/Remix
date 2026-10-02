import { getTranslations } from 'next-intl/server';
import { ContentSkeleton } from '@/components/shell/content-skeleton';

export default async function Loading() {
  const t = await getTranslations('portal.classes');
  return <ContentSkeleton cards={3} label={t('loading')} />;
}
