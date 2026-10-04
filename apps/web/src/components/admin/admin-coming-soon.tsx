import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import { ComingSoon } from '@/components/shell/coming-soon';
import { ADMIN_PATHS } from '@/lib/paths';
import { requireStaff } from '@/server/api';

type Section = 'students' | 'fees' | 'more';

/** An admin section a later phase builds (Students, Fees, Classes, More). */
export async function AdminComingSoon({
  section,
  icon,
  children,
}: {
  section: Section;
  icon: ReactNode;
  children?: ReactNode;
}) {
  await requireStaff();
  const t = await getTranslations('admin');
  return (
    <ComingSoon
      width="admin"
      title={t(`meta.${section}`)}
      heading={t('soon.title')}
      description={t(`soon.${section}`)}
      icon={icon}
      backHref={ADMIN_PATHS.home}
      backLabel={t('soon.backHome')}
    >
      {children}
    </ComingSoon>
  );
}
