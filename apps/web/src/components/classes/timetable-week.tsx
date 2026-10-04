import { EmptyState, StatusBadge, buttonClass, cn } from '@remix/ui';
import type { TimetableSlot } from '@remix/types/api';
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react';
import Link from 'next/link';
import { getFormatter, getLocale, getTranslations } from 'next-intl/server';
import { addDays, dateAt, endTime, formatTime, slotsByDate, weekDates } from '@/lib/classes';
import { ADMIN_PATHS } from '@/lib/paths';

const weekHref = (weekStart: string, thisWeek: string) =>
  weekStart === thisWeek ? ADMIN_PATHS.timetable : `${ADMIN_PATHS.timetable}?week=${weekStart}`;

type ClassesT = Awaited<ReturnType<typeof getTranslations<'classes'>>>;

/** One class occurrence as a link: time range, class, where, and (for staff) the student count. */
function SlotLink({
  slot,
  t,
  locale,
  showCount,
}: {
  slot: TimetableSlot;
  t: ClassesT;
  locale: string;
  showCount: boolean;
}) {
  const where =
    slot.place === 'online'
      ? t('place.online')
      : t('placeValue', { place: slot.place, hall: slot.hallName ?? t('hallFallback') });
  return (
    <Link
      href={`${ADMIN_PATHS.classes}/${slot.classId}`}
      className="bg-surface border-line hover:border-brand flex min-h-11 flex-col gap-0.5 rounded-md border p-2.5 text-sm"
    >
      <span className="text-brand font-semibold">
        {t('timeRange', {
          start: formatTime(slot.startTime, locale),
          end: formatTime(endTime(slot.startTime, slot.durationMinutes), locale),
        })}
      </span>
      <span className="font-medium">{slot.className}</span>
      <span className="text-muted">{where}</span>
      {showCount ? (
        <span className="text-muted">{t('timetable.students', { count: slot.studentCount })}</span>
      ) : null}
    </Link>
  );
}

/** One class occurrence on its own (the dashboard's "Today's classes"). */
export async function SlotCard({
  slot,
  showCount = true,
}: {
  slot: TimetableSlot;
  showCount?: boolean;
}) {
  const [t, locale] = await Promise.all([getTranslations('classes'), getLocale()]);
  return <SlotLink slot={slot} t={t} locale={locale} showCount={showCount} />;
}

/**
 * The weekly timetable (CLS-06, Monday first): seven columns from `lg`, a day-by-day list on
 * phones. Today is marked with a word, not just a colour. Every slot links to its class.
 */
export async function TimetableWeek({
  weekStart,
  slots,
  today,
  thisWeek,
}: {
  weekStart: string;
  slots: readonly TimetableSlot[];
  today: string;
  thisWeek: string;
}) {
  const [t, tAll, format, locale] = await Promise.all([
    getTranslations('classes.timetable'),
    getTranslations('classes'),
    getFormatter(),
    getLocale(),
  ]);
  const byDate = slotsByDate(slots);
  const dates = weekDates(weekStart);
  const range = (d: string) => format.dateTime(dateAt(d), { day: 'numeric', month: 'short' });
  const last = dates[6] ?? weekStart;

  return (
    <div className="flex flex-col gap-4">
      <nav aria-label={t('navLabel')} className="flex flex-wrap items-center gap-2">
        <Link
          href={weekHref(addDays(weekStart, -7), thisWeek)}
          className={buttonClass({ variant: 'secondary', size: 'md' })}
        >
          <ChevronLeft aria-hidden size={16} />
          {t('previous')}
        </Link>
        <Link
          href={weekHref(thisWeek, thisWeek)}
          aria-current={weekStart === thisWeek ? 'page' : undefined}
          className={buttonClass({
            variant: weekStart === thisWeek ? 'primary' : 'secondary',
            size: 'md',
          })}
        >
          {t('thisWeek')}
        </Link>
        <Link
          href={weekHref(addDays(weekStart, 7), thisWeek)}
          className={buttonClass({ variant: 'secondary', size: 'md' })}
        >
          {t('next')}
          <ChevronRight aria-hidden size={16} />
        </Link>
        <p className="text-muted m-0 text-sm" aria-live="polite">
          {t('weekOf', { start: range(weekStart), end: range(last) })}
        </p>
      </nav>

      {slots.length === 0 ? (
        <EmptyState
          className="bg-surface border-line rounded-lg border"
          size="compact"
          icon={<CalendarDays />}
          title={t('empty.title')}
          description={t('empty.body')}
        />
      ) : null}

      <ol className="m-0 grid list-none grid-cols-1 gap-3 p-0 lg:grid-cols-7">
        {dates.map((date) => {
          const day = byDate.get(date) ?? [];
          const isToday = date === today;
          return (
            <li
              key={date}
              className={cn(
                'bg-canvas border-line flex min-w-0 flex-col gap-2 rounded-lg border p-2.5',
                isToday && 'border-brand bg-brand-soft',
              )}
            >
              <h3 className="m-0 flex flex-wrap items-center justify-between gap-1 text-sm font-semibold">
                {format.dateTime(dateAt(date), {
                  weekday: 'short',
                  day: 'numeric',
                  month: 'short',
                })}
                {isToday ? <StatusBadge tone="info">{t('today')}</StatusBadge> : null}
              </h3>
              {day.length === 0 ? (
                <p className="text-muted m-0 text-sm">{t('noClasses')}</p>
              ) : (
                <ul className="m-0 flex list-none flex-col gap-2 p-0">
                  {day.map((slot) => (
                    <li key={`${slot.classId}-${slot.startTime}`}>
                      <SlotLink slot={slot} t={tAll} locale={locale} showCount />
                    </li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
