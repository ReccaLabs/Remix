import { can } from '@remix/types';
import { buttonClass, EmptyState } from '@remix/ui';
import { CircleAlert } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { ClassStudentsPanel } from '@/components/classes/class-students-panel';
import {
  ClassHeader,
  ClassKpis,
  ClassTabs,
  LaterTab,
  parseClassTab,
  ScheduleTab,
} from '@/components/classes/class-detail';
import { PeopleIsland } from '@/components/people/people-island';
import { PageBody } from '@/components/shell/page-body';
import { ADMIN_PATHS } from '@/lib/paths';
import { requireStaff } from '@/server/api';
import { loadClass, loadClassStudents } from '@/server/classes';
import { classesMetadata } from '@/server/classes-metadata';
import { loadClassOptions } from '@/server/people';

/**
 * Class detail (8c desktop, 8e phone). The tab is `?tab=`; Lessons, Fees and Attendance belong to
 * later phases and show an empty state. A teacher reaches only their own classes (the API answers
 * 404 otherwise).
 */

export const generateMetadata = () => classesMetadata('detail');

export default async function ClassDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ id }, query, session] = await Promise.all([params, searchParams, requireStaff()]);
  const roles = session.user.roles;
  const canWrite = can(roles, 'classes.write');
  const canEnrol = can(roles, 'enrollments.write');
  const tab = parseClassTab(query.tab);

  const [result, t] = await Promise.all([loadClass(id), getTranslations('classes.list')]);
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
              href={`${ADMIN_PATHS.classes}/${id}`}
              className={buttonClass({ variant: 'secondary' })}
            >
              {t('loadError.retry')}
            </a>
          }
        />
      </PageBody>
    );
  }
  const cls = result.data;
  const [students, others] =
    tab === 'students'
      ? await Promise.all([loadClassStudents(id), canEnrol ? loadClassOptions() : []])
      : [null, []];

  return (
    <PageBody width="admin">
      <PeopleIsland namespaces={['classes']}>
        <ClassHeader cls={cls} canWrite={canWrite} />
        <ClassKpis cls={cls} />
        <ClassTabs classId={id} current={tab} />
        {tab === 'students' ? (
          students?.ok ? (
            <ClassStudentsPanel
              classId={id}
              className={cls.name}
              classFeeCents={cls.feeCents}
              students={students.data}
              moveTargets={others.filter((c) => c.id !== id)}
              canEnrol={canEnrol}
              archived={cls.archivedAt !== null}
            />
          ) : (
            <EmptyState
              className="bg-surface border-line rounded-lg border"
              icon={<CircleAlert />}
              title={t('loadError.title')}
              description={t('loadError.body')}
            />
          )
        ) : null}
        {tab === 'schedule' ? <ScheduleTab cls={cls} /> : null}
        {tab === 'lessons' || tab === 'fees' || tab === 'attendance' ? (
          <LaterTab tab={tab} />
        ) : null}
      </PeopleIsland>
    </PageBody>
  );
}
