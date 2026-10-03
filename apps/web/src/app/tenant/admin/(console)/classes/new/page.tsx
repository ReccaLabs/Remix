import { can } from '@remix/types';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { ClassForm } from '@/components/classes/class-form';
import { PeopleIsland } from '@/components/people/people-island';
import { PageBody, PageTitle } from '@/components/shell/page-body';
import { requireStaff } from '@/server/api';
import { loadHallOptions, loadTeacherOptions } from '@/server/classes';
import { classesMetadata } from '@/server/classes-metadata';

/** New class (8b). Owners and admins only (`classes.write`); everyone else gets the 404 page. */

export const generateMetadata = () => classesMetadata('new');

export default async function NewClassPage() {
  const session = await requireStaff();
  if (!can(session.user.roles, 'classes.write')) notFound();
  const [halls, teachers, t] = await Promise.all([
    loadHallOptions(),
    loadTeacherOptions(),
    getTranslations('classes.form'),
  ]);
  return (
    <PageBody width="admin">
      <PageTitle title={t('titleNew')} />
      <PeopleIsland namespaces={['classes']}>
        <ClassForm mode="create" halls={halls} teachers={teachers} />
      </PeopleIsland>
    </PageBody>
  );
}
