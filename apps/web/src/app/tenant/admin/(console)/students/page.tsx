import { can } from '@remix/types';
import { buttonClass, EmptyState } from '@remix/ui';
import { CircleAlert, FileUp, UserPlus } from 'lucide-react';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { PeopleIsland } from '@/components/people/people-island';
import { PageBody, PageTitle } from '@/components/shell/page-body';
import { StudentsPagination } from '@/components/students/students-pagination';
import { StudentsTable } from '@/components/students/students-table';
import { StudentsToolbar } from '@/components/students/students-toolbar';
import { ADMIN_PATHS } from '@/lib/paths';
import { hasFilters, parseListQuery } from '@/lib/people';
import { requireStaff } from '@/server/api';
import { loadClassOptions, loadStudents } from '@/server/people';
import { studentsMetadata } from '@/server/people-metadata';

/**
 * Admin Students (12a desktop, 12e phone): search, filters, bulk actions, 25–100 per page.
 * The list comes from the API with the URL's query; a teacher only ever gets their own classes'
 * students (STF-02, enforced by the API).
 */

export const generateMetadata = () => studentsMetadata('list');

export default async function StudentsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requireStaff();
  const query = parseListQuery(await searchParams);
  const roles = session.user.roles;
  const canWrite = can(roles, 'students.write');
  const canDevices = can(roles, 'students.devices');
  const canImport = can(roles, 'students.import');

  const [result, classes, t, tImport] = await Promise.all([
    loadStudents(query),
    loadClassOptions(),
    getTranslations('students.list'),
    getTranslations('import.entry'),
  ]);

  return (
    <PageBody width="admin">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <PageTitle
          title={t('title')}
          subtitle={result.ok ? t('count', { count: result.data.total }) : undefined}
        />
        <div className="flex flex-wrap gap-2">
          {canImport ? (
            <Link
              href={`${ADMIN_PATHS.students}/import`}
              className={buttonClass({ variant: 'secondary', size: 'md' })}
            >
              <FileUp aria-hidden size={18} />
              {tImport('button')}
            </Link>
          ) : null}
          {canWrite ? (
            <Link
              href={`${ADMIN_PATHS.students}/new`}
              className={buttonClass({ variant: 'primary', size: 'md' })}
            >
              <UserPlus aria-hidden size={18} />
              {t('add')}
            </Link>
          ) : null}
        </div>
      </div>

      <PeopleIsland namespaces={['students']}>
        <StudentsToolbarSection query={query} classes={classes} />
        {result.ok ? (
          <>
            <StudentsTable
              items={result.data.items}
              classes={classes}
              canWrite={canWrite}
              canDevices={canDevices}
              archivedView={query.status === 'archived'}
              filtered={hasFilters(query)}
              clearHref={ADMIN_PATHS.students}
            />
            <StudentsPagination query={query} total={result.data.total} />
          </>
        ) : (
          <EmptyState
            className="bg-surface border-line rounded-lg border"
            icon={<CircleAlert />}
            title={t('loadError.title')}
            description={t('loadError.body')}
            action={
              <a href={ADMIN_PATHS.students} className={buttonClass({ variant: 'secondary' })}>
                {t('loadError.retry')}
              </a>
            }
          />
        )}
      </PeopleIsland>
    </PageBody>
  );
}

function StudentsToolbarSection(props: Parameters<typeof StudentsToolbar>[0]) {
  // `key` re-creates the uncontrolled form when the URL (the source of truth) changes.
  return <StudentsToolbar key={JSON.stringify(props.query)} {...props} />;
}
