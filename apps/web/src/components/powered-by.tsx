import { cn } from '@remix/ui';
import { getTranslations } from 'next-intl/server';

/** "Powered by ReMix" footnote on institute-branded pages. */
export async function PoweredBy({ className }: { className?: string }) {
  const t = await getTranslations('common.meta');
  return <p className={cn('text-muted m-0 text-xs', className)}>{t('poweredBy')}</p>;
}
