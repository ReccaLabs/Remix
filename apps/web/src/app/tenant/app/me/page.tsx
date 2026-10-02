import { ShellUser } from '@remix/ui';
import { UserRound } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { LogoutButton } from '@/components/auth/logout-button';
import { ComingSoon } from '@/components/shell/coming-soon';
import { initials } from '@/lib/initials';
import { PORTAL_PATHS, TENANT_PATHS } from '@/lib/paths';
import { requireStudent } from '@/server/api';
import { portalMetadata } from '@/server/metadata';

// Student Me (devices, password, language — AUTH-04) arrives in Phase 2. Log out lives here too.

export const generateMetadata = () => portalMetadata('me');

export default async function MePage() {
  const session = await requireStudent();
  const t = await getTranslations('portal');
  const name = session.user.displayName;
  return (
    <ComingSoon
      title={t('meta.me')}
      heading={t('soon.title')}
      description={t('soon.me')}
      icon={<UserRound />}
      backHref={PORTAL_PATHS.home}
      backLabel={t('soon.backHome')}
    >
      <div className="bg-surface border-line flex flex-wrap items-center justify-between gap-3 rounded-lg border p-4">
        <ShellUser name={name} meta={t('shell.student')} initials={initials(name)} />
        <LogoutButton redirectTo={TENANT_PATHS.studentLogin} />
      </div>
    </ComingSoon>
  );
}
