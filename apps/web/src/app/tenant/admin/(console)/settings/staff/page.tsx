import { can } from '@remix/types';
import { buttonClass, EmptyState } from '@remix/ui';
import { CircleAlert } from 'lucide-react';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { PeopleIsland } from '@/components/people/people-island';
import { PageBody, PageTitle } from '@/components/shell/page-body';
import { StaffPanel } from '@/components/staff/staff-panel';
import { ADMIN_PATHS } from '@/lib/paths';
import { requireStaff } from '@/server/api';
import { loadClassOptions, loadStaff } from '@/server/people';
import { staffMetadata } from '@/server/people-metadata';

/**
 * Settings → Staff and roles (STF-01/02/03). Owners only: everyone else gets the 404 page (their
 * role never reveals it exists); the API answers 403 on every call anyway.
 */

export const generateMetadata = staffMetadata;

export default async function StaffSettingsPage() {
  const session = await requireStaff();
  if (!can(session.user.roles, 'staff.manage')) notFound();
  const [result, classes, t] = await Promise.all([
    loadStaff(),
    loadClassOptions(),
    getTranslations('staff'),
  ]);

  return (
    <PageBody width="admin">
      <PageTitle title={t('title')} subtitle={t('subtitle')} />
      {result.ok ? (
        <PeopleIsland namespaces={['staff']}>
          <StaffPanel data={result.data} classes={classes} currentUserId={session.user.id} />
        </PeopleIsland>
      ) : (
        <EmptyState
          className="bg-surface border-line rounded-lg border"
          icon={<CircleAlert />}
          title={t('loadError.title')}
          description={t('loadError.body')}
          action={
            <a href={ADMIN_PATHS.staff} className={buttonClass({ variant: 'secondary' })}>
              {t('loadError.retry')}
            </a>
          }
        />
      )}
    </PageBody>
  );
}
