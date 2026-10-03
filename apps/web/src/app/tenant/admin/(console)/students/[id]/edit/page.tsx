import { can } from '@remix/types';
import { ChevronLeft } from 'lucide-react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { PeopleIsland } from '@/components/people/people-island';
import { PageBody, PageTitle } from '@/components/shell/page-body';
import { StudentForm } from '@/components/students/student-form';
import { ADMIN_PATHS } from '@/lib/paths';
import { requireStaff } from '@/server/api';
import { loadStudent } from '@/server/people';
import { studentsMetadata } from '@/server/people-metadata';

/** Edit student (STU-05). Staff who may write students only. */

export const generateMetadata = () => studentsMetadata('edit');

export default async function EditStudentPage({ params }: { params: Promise<{ id: string }> }) {
  const [{ id }, session] = await Promise.all([params, requireStaff()]);
  if (!can(session.user.roles, 'students.write')) notFound();
  const [result, t] = await Promise.all([loadStudent(id), getTranslations('students.form')]);
  if (!result.ok) notFound();

  return (
    <PageBody width="admin">
      <Link
        href={`${ADMIN_PATHS.students}/${id}`}
        className="text-muted hover:text-ink inline-flex min-h-11 items-center gap-1 self-start text-sm"
      >
        <ChevronLeft aria-hidden size={16} />
        {t('backToProfile')}
      </Link>
      <PageTitle title={t('titleEdit', { name: result.data.displayName })} />
      <PeopleIsland namespaces={['students']}>
        <StudentForm mode="edit" student={result.data} />
      </PeopleIsland>
    </PageBody>
  );
}
