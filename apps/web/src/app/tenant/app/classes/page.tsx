import { EmptyState } from '@remix/ui';
import { BookOpen } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { ClassCard } from '@/components/portal/class-card';
import { LoadError } from '@/components/portal/load-error';
import { PageBody, PageTitle } from '@/components/shell/page-body';
import { PORTAL_PATHS } from '@/lib/paths';
import { requireStudent } from '@/server/api';
import { portalMetadata } from '@/server/metadata';
import { loadMyClasses } from '@/server/portal';

/** Student Classes 3a (phone) / 3e (desktop): the classes this student is enrolled in. */

export const generateMetadata = () => portalMetadata('classes');

export default async function ClassesPage() {
  await requireStudent();
  const [result, t] = await Promise.all([loadMyClasses(), getTranslations('portal.classes')]);

  return (
    <PageBody>
      <PageTitle
        title={t('title')}
        subtitle={
          result.ok && result.items.length > 0
            ? t('count', { count: result.items.length })
            : undefined
        }
      />
      {!result.ok ? (
        <LoadError retryHref={PORTAL_PATHS.classes} />
      ) : result.items.length === 0 ? (
        <EmptyState
          className="bg-surface border-line rounded-lg border"
          icon={<BookOpen />}
          title={t('emptyTitle')}
          description={t('emptyBody')}
        />
      ) : (
        <ul className="m-0 grid list-none gap-3 p-0 md:grid-cols-2 lg:gap-5 xl:grid-cols-3">
          {result.items.map((cls) => (
            <li key={cls.id}>
              <ClassCard cls={cls} />
            </li>
          ))}
        </ul>
      )}
    </PageBody>
  );
}
