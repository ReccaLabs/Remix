import { can } from '@remix/types';
import { buttonClass, EmptyState } from '@remix/ui';
import { CircleAlert } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { DevicesPanel } from '@/components/students/devices-panel';
import { PeopleIsland } from '@/components/people/people-island';
import { PageBody } from '@/components/shell/page-body';
import {
  ClassesTab,
  LaterTab,
  OverviewTab,
  ParentTab,
  parseTab,
  PROFILE_TABS,
  StudentHeader,
  StudentTabs,
} from '@/components/students/student-profile';
import { ADMIN_PATHS } from '@/lib/paths';
import { requireStaff } from '@/server/api';
import { loadStudent } from '@/server/people';
import { studentsMetadata } from '@/server/people-metadata';

/**
 * Student profile (12b overview, 12c devices, 12f phone). The tab is `?tab=`; the Devices tab
 * exists only for roles with `students.devices`. A teacher reaches only students of their classes
 * (the API answers 404 otherwise).
 */

export const generateMetadata = () => studentsMetadata('profile');

export default async function StudentProfilePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ id }, query, session] = await Promise.all([params, searchParams, requireStaff()]);
  const roles = session.user.roles;
  const canWrite = can(roles, 'students.write');
  const canDevices = can(roles, 'students.devices');
  const tabs = PROFILE_TABS.filter((tab) => tab !== 'devices' || canDevices);
  const tab = parseTab(query.tab, tabs);

  const [result, t] = await Promise.all([loadStudent(id), getTranslations('students.list')]);

  if (!result.ok) {
    return (
      <PageBody width="admin">
        <EmptyState
          className="bg-surface border-line rounded-lg border"
          icon={<CircleAlert />}
          title={t('loadError.title')}
          description={t('loadError.body')}
          action={
            <a
              href={`${ADMIN_PATHS.students}/${id}`}
              className={buttonClass({ variant: 'secondary' })}
            >
              {t('loadError.retry')}
            </a>
          }
        />
      </PageBody>
    );
  }
  const student = result.data;

  return (
    <PageBody width="admin">
      <PeopleIsland namespaces={['students']}>
        <StudentHeader student={student} canWrite={canWrite} />
        <StudentTabs studentId={id} current={tab} tabs={tabs} />
        {tab === 'overview' ? <OverviewTab student={student} /> : null}
        {tab === 'classes' ? <ClassesTab student={student} /> : null}
        {tab === 'payments' || tab === 'attendance' ? <LaterTab tab={tab} /> : null}
        {tab === 'devices' ? (
          <DevicesPanel studentId={id} name={student.displayName} devices={student.devices} />
        ) : null}
        {tab === 'parent' ? <ParentTab student={student} /> : null}
      </PeopleIsland>
    </PageBody>
  );
}
