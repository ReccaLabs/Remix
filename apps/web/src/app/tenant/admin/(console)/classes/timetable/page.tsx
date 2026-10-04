import { buttonClass, EmptyState } from '@remix/ui';
import { CircleAlert } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { ClassViews } from '@/components/classes/class-views';
import { TimetableWeek } from '@/components/classes/timetable-week';
import { PageBody, PageTitle } from '@/components/shell/page-body';
import { colomboDate, mondayOf, parseWeek } from '@/lib/classes';
import { ADMIN_PATHS } from '@/lib/paths';
import { requireStaff } from '@/server/api';
import { loadTimetable } from '@/server/classes';
import { classesMetadata } from '@/server/classes-metadata';

/**
 * Weekly timetable (CLS-06): the week is `?week=` (any date selects its Monday), Monday first,
 * Asia/Colombo dates. Teachers see only their own classes.
 */

export const generateMetadata = () => classesMetadata('timetable');

export default async function TimetablePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireStaff();
  const query = await searchParams;
  const today = colomboDate();
  const thisWeek = mondayOf(today);
  const weekStart = parseWeek(query.week, today);
  const [result, t] = await Promise.all([loadTimetable(weekStart), getTranslations('classes')]);

  return (
    <PageBody width="admin">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <PageTitle title={t('timetable.title')} />
        <ClassViews current="week" />
      </div>
      {result.ok ? (
        <TimetableWeek
          weekStart={result.data.weekStart}
          slots={result.data.slots}
          today={today}
          thisWeek={thisWeek}
        />
      ) : (
        <EmptyState
          className="bg-surface border-line rounded-lg border"
          icon={<CircleAlert />}
          title={t('timetable.loadError.title')}
          description={t('timetable.loadError.body')}
          action={
            <a href={ADMIN_PATHS.timetable} className={buttonClass({ variant: 'secondary' })}>
              {t('timetable.loadError.retry')}
            </a>
          }
        />
      )}
    </PageBody>
  );
}
