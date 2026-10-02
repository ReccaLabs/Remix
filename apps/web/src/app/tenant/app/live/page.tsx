import { Video } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { ComingSoon } from '@/components/shell/coming-soon';
import { PORTAL_PATHS } from '@/lib/paths';
import { requireStudent } from '@/server/api';
import { portalMetadata } from '@/server/metadata';

// Student Live arrives with live classes (LIV, later phase).

export const generateMetadata = () => portalMetadata('live');

export default async function LivePage() {
  await requireStudent();
  const t = await getTranslations('portal');
  return (
    <ComingSoon
      title={t('meta.live')}
      heading={t('soon.title')}
      description={t('soon.live')}
      icon={<Video />}
      backHref={PORTAL_PATHS.home}
      backLabel={t('soon.backHome')}
    />
  );
}
