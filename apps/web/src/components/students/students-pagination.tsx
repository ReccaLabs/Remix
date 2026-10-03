import { buttonClass } from '@remix/ui';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { ADMIN_PATHS } from '@/lib/paths';
import { studentsHref, type ListQuery } from '@/lib/people';

/** Previous / next links with "1–25 of 468". Plain links: they work without JavaScript. */
export async function StudentsPagination({ query, total }: { query: ListQuery; total: number }) {
  const t = await getTranslations('students.list.pagination');
  if (total === 0) return null;
  const pages = Math.max(1, Math.ceil(total / query.pageSize));
  const page = Math.min(query.page, pages);
  const from = (page - 1) * query.pageSize + 1;
  const to = Math.min(total, page * query.pageSize);
  const href = (p: number) => studentsHref(ADMIN_PATHS.students, { ...query, page: p });

  return (
    <nav
      aria-label={t('label')}
      className="flex flex-wrap items-center justify-between gap-3 text-sm"
    >
      <p className="text-muted m-0">{t('range', { from, to, total })}</p>
      <div className="flex items-center gap-2">
        <span className="text-muted">{t('page', { page, pages })}</span>
        {page > 1 ? (
          <Link
            href={href(page - 1)}
            rel="prev"
            className={buttonClass({ variant: 'secondary', size: 'md' })}
          >
            <ChevronLeft aria-hidden size={16} />
            {t('previous')}
          </Link>
        ) : null}
        {page < pages ? (
          <Link
            href={href(page + 1)}
            rel="next"
            className={buttonClass({ variant: 'secondary', size: 'md' })}
          >
            {t('next')}
            <ChevronRight aria-hidden size={16} />
          </Link>
        ) : null}
      </div>
    </nav>
  );
}
