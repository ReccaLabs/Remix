import { Wallet } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { ComingSoon } from '@/components/shell/coming-soon';
import { PORTAL_PATHS } from '@/lib/paths';
import { requireStudent } from '@/server/api';
import { portalMetadata } from '@/server/metadata';

// Student Pay arrives with online fee payments (FEE, later phase).

export const generateMetadata = () => portalMetadata('pay');

export default async function PayPage() {
  await requireStudent();
  const t = await getTranslations('portal');
  return (
    <ComingSoon
      title={t('meta.pay')}
      heading={t('soon.title')}
      description={t('soon.pay')}
      icon={<Wallet />}
      backHref={PORTAL_PATHS.home}
      backLabel={t('soon.backHome')}
    />
  );
}
