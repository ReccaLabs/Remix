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
import { loadClassOptions } from '@/server/people';
import { studentsMetadata } from '@/server/people-metadata';

/** Add student (STU-03, PAR-01, PAR-03). Staff who may write students only. */

export const generateMetadata = () => studentsMetadata('new');

export default async function NewStudentPage() {
  const session = await requireStaff();
  if (!can(session.user.roles, 'students.write')) notFound();
  const [classes, t] = await Promise.all([loadClassOptions(), getTranslations('students.form')]);

  return (
    <PageBody width="admin">
      <Link
        href={ADMIN_PATHS.students}
        className="text-muted hover:text-ink inline-flex min-h-11 items-center gap-1 self-start text-sm"
      >
        <ChevronLeft aria-hidden size={16} />
        {t('back')}
      </Link>
      <PageTitle title={t('titleNew')} subtitle={t('subtitleNew')} />
      <PeopleIsland namespaces={['students']}>
        <StudentForm mode="create" classes={classes} />
      </PeopleIsland>
    </PageBody>
  );
}
