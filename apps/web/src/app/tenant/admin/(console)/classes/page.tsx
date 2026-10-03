import { can } from '@remix/types';
import { buttonClass, EmptyState } from '@remix/ui';
import { CircleAlert, Plus } from 'lucide-react';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { ClassViews } from '@/components/classes/class-views';
import { ClassesList } from '@/components/classes/classes-list';
import { ClassesToolbar } from '@/components/classes/classes-toolbar';
import { PeopleIsland } from '@/components/people/people-island';
import { PageBody, PageTitle } from '@/components/shell/page-body';
import { gradesOf, hasClassFilters, parseClassesQuery, teachersOf } from '@/lib/classes';
import { ADMIN_PATHS } from '@/lib/paths';
import { requireStaff } from '@/server/api';
import { loadClasses } from '@/server/classes';
import { classesMetadata } from '@/server/classes-metadata';

/**
 * Admin Classes (8a desktop, 8d phone): search and filters in the URL, a table from `lg` and
 * cards on phones. A teacher only ever gets their own classes (STF-02, enforced by the API).
 */

export const generateMetadata = () => classesMetadata('list');

export default async function ClassesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requireStaff();
  const query = parseClassesQuery(await searchParams);
  const filtered = hasClassFilters(query);
  const canWrite = can(session.user.roles, 'classes.write');

  // The unfiltered list feeds the filter choices (grades, teachers).
  const [result, everything, t] = await Promise.all([
    loadClasses(query),
    filtered ? loadClasses(parseClassesQuery({})) : undefined,
    getTranslations('classes.list'),
  ]);
  const choices = (everything ?? result).ok ? (everything ?? result) : null;
  const options = choices?.ok ? choices.data.items : [];

  return (
    <PageBody width="admin">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <PageTitle
          title={t('title')}
          subtitle={
            result.ok
              ? t('count', {
                  count: result.data.items.length,
                  students: result.data.items.reduce((sum, c) => sum + c.studentCount, 0),
                })
              : undefined
          }
        />
        <div className="flex flex-wrap items-center gap-3">
          <ClassViews current="list" />
          {canWrite ? (
            <Link
              href={`${ADMIN_PATHS.classes}/new`}
              className={buttonClass({ variant: 'primary', size: 'md' })}
            >
              <Plus aria-hidden size={18} />
              {t('create')}
            </Link>
          ) : null}
        </div>
      </div>

      <PeopleIsland namespaces={['classes']}>
        <ClassesToolbar
          key={JSON.stringify(query)}
          query={query}
          grades={gradesOf(options)}
          teachers={teachersOf(options)}
        />
      </PeopleIsland>
      {result.ok ? (
        <ClassesList
          items={result.data.items}
          filtered={filtered}
          clearHref={ADMIN_PATHS.classes}
          canWrite={canWrite}
        />
      ) : (
        <EmptyState
          className="bg-surface border-line rounded-lg border"
          icon={<CircleAlert />}
          title={t('loadError.title')}
          description={t('loadError.body')}
          action={
            <a href={ADMIN_PATHS.classes} className={buttonClass({ variant: 'secondary' })}>
              {t('loadError.retry')}
            </a>
          }
        />
      )}
    </PageBody>
  );
}
