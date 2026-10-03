import { can } from '@remix/types';
import { buttonClass, EmptyState } from '@remix/ui';
import { CircleAlert } from 'lucide-react';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { ClassForm } from '@/components/classes/class-form';
import { PeopleIsland } from '@/components/people/people-island';
import { PageBody, PageTitle } from '@/components/shell/page-body';
import { ADMIN_PATHS } from '@/lib/paths';
import { requireStaff } from '@/server/api';
import { loadClass, loadHallOptions, loadTeacherOptions } from '@/server/classes';
import { classesMetadata } from '@/server/classes-metadata';

/** Edit class (CLS-02). Owners and admins only (`classes.write`). */

export const generateMetadata = () => classesMetadata('edit');

export default async function EditClassPage({ params }: { params: Promise<{ id: string }> }) {
  const [{ id }, session] = await Promise.all([params, requireStaff()]);
  if (!can(session.user.roles, 'classes.write')) notFound();
  const [result, halls, teachers, t, tList] = await Promise.all([
    loadClass(id),
    loadHallOptions(),
    loadTeacherOptions(),
    getTranslations('classes.form'),
    getTranslations('classes.list'),
  ]);
  if (!result.ok) {
    return (
      <PageBody width="admin">
        <EmptyState
          className="bg-surface border-line rounded-lg border"
          icon={<CircleAlert />}
          title={tList('loadError.title')}
          description={tList('loadError.body')}
          action={
            <a
              href={`${ADMIN_PATHS.classes}/${id}/edit`}
              className={buttonClass({ variant: 'secondary' })}
            >
              {tList('loadError.retry')}
            </a>
          }
        />
      </PageBody>
    );
  }
  return (
    <PageBody width="admin">
      <PageTitle title={t('titleEdit')} subtitle={result.data.name} />
      <PeopleIsland namespaces={['classes']}>
        <ClassForm mode="edit" cls={result.data} halls={halls} teachers={teachers} />
      </PeopleIsland>
    </PageBody>
  );
}
