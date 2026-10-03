import { can } from '@remix/types';
import { ChevronLeft } from 'lucide-react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { PeopleIsland } from '@/components/people/people-island';
import { PageBody, PageTitle } from '@/components/shell/page-body';
import { ImportWizard } from '@/components/students/import/import-wizard';
import { ADMIN_PATHS } from '@/lib/paths';
import { requireStaff } from '@/server/api';
import { importMetadata } from '@/server/people-metadata';

/**
 * Import students from a CSV or Excel file (STU-04, DAT-01): upload, column mapping, dry-run
 * preview, commit with progress and an error file. Owners and admins (`students.import`) only.
 */

export const generateMetadata = () => importMetadata();

export default async function ImportStudentsPage() {
  const session = await requireStaff();
  if (!can(session.user.roles, 'students.import')) notFound();
  const t = await getTranslations('import.page');

  return (
    <PageBody width="admin">
      <Link
        href={ADMIN_PATHS.students}
        className="text-muted hover:text-ink inline-flex min-h-11 items-center gap-1 self-start text-sm"
      >
        <ChevronLeft aria-hidden size={16} />
        {t('back')}
      </Link>
      <PageTitle title={t('title')} subtitle={t('subtitle')} />
      <PeopleIsland namespaces={['import']}>
        <ImportWizard />
      </PeopleIsland>
    </PageBody>
  );
}
