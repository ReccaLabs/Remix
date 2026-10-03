import {
  DataTable,
  EmptyState,
  StatCard,
  StatusBadge,
  buttonClass,
  type DataTableColumn,
} from '@remix/ui';
import type { ClassDetail, ClassSchedule } from '@remix/types/api';
import { CalendarClock, ChevronLeft, Pencil } from 'lucide-react';
import Link from 'next/link';
import { getFormatter, getLocale, getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import { endTime, formatFee, formatTime } from '@/lib/classes';
import { ADMIN_PATHS } from '@/lib/paths';
import { formatSlot, sortedSchedule } from '@/lib/schedule';
import { ClassArchive } from './class-archive';

export const CLASS_TABS = ['students', 'schedule', 'lessons', 'fees', 'attendance'] as const;
export type ClassTab = (typeof CLASS_TABS)[number];

export function parseClassTab(value: string | string[] | undefined): ClassTab {
  const tab = Array.isArray(value) ? value[0] : value;
  return CLASS_TABS.find((t) => t === tab) ?? 'students';
}

const classHref = (id: string, tab?: ClassTab) =>
  tab && tab !== 'students'
    ? `${ADMIN_PATHS.classes}/${id}?tab=${tab}`
    : `${ADMIN_PATHS.classes}/${id}`;

/** Detail header (Admin Classes 8c/8e): name, the facts in one line, and the actions. */
export async function ClassHeader({ cls, canWrite }: { cls: ClassDetail; canWrite: boolean }) {
  const [t, tMedium, locale] = await Promise.all([
    getTranslations('classes'),
    getTranslations('classes.medium'),
    getLocale(),
  ]);
  const slots = sortedSchedule(cls.schedule);
  const [first] = slots;
  const scheduleText = first
    ? (() => {
        const { weekday, time } = formatSlot(first, locale);
        const base = t('slot', { weekday, time });
        return slots.length > 1 ? `${base} +${slots.length - 1}` : base;
      })()
    : t('list.noSchedule');

  return (
    <header className="flex flex-col gap-4">
      <Link
        href={ADMIN_PATHS.classes}
        className="text-muted hover:text-ink inline-flex min-h-11 items-center gap-1 self-start text-sm"
      >
        <ChevronLeft aria-hidden size={16} />
        {t('detail.back')}
      </Link>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="m-0 text-2xl font-semibold leading-8 tracking-[-0.015em]">{cls.name}</h1>
            {cls.archivedAt ? (
              <StatusBadge tone="neutral">{t('list.archivedBadge')}</StatusBadge>
            ) : null}
          </div>
          <p className="text-muted m-0 text-sm">
            {t('detail.headline', {
              teacher: cls.teacherName ?? t('detail.noTeacherShort'),
              schedule: scheduleText,
              place: t('placeValue', { place: cls.place, hall: cls.hallName ?? t('hallFallback') }),
              medium: tMedium(cls.medium),
              fee: formatFee(cls.feeCents),
            })}
          </p>
        </div>
        {canWrite ? (
          <div className="flex flex-wrap gap-2">
            <Link
              href={`${ADMIN_PATHS.classes}/${cls.id}/edit`}
              className={buttonClass({ variant: 'secondary' })}
            >
              <Pencil aria-hidden size={16} />
              {t('detail.edit')}
            </Link>
            {cls.archivedAt ? null : <ClassArchive classId={cls.id} name={cls.name} />}
          </div>
        ) : null}
      </div>
      {cls.archivedAt ? <p className="text-muted m-0 text-sm">{t('detail.archived')}</p> : null}
    </header>
  );
}

/** The four numbers under the header. Fee and attendance figures show "—" until Phases 3/5. */
export async function ClassKpis({ cls }: { cls: ClassDetail }) {
  const t = await getTranslations('classes.detail.kpis');
  const format = await getFormatter();
  const dash = (
    <>
      <span aria-hidden>—</span>
      <span className="sr-only">{t('pending')}</span>
    </>
  );
  const card = (label: string, value: ReactNode, detail?: string) => (
    <li>
      <StatCard
        className="h-full"
        label={label}
        value={value}
        detail={detail ? { text: detail } : undefined}
      />
    </li>
  );
  const number = (n: number | null) => (n === null ? dash : format.number(n));
  return (
    <section aria-label={t('label')}>
      <ul className="m-0 grid list-none grid-cols-2 gap-2.5 p-0 lg:grid-cols-4 lg:gap-4">
        {card(t('enrolled'), format.number(cls.kpis.enrolled))}
        {card(
          t('paid'),
          number(cls.kpis.paid),
          cls.kpis.paid === null ? t('pendingFees') : undefined,
        )}
        {card(
          t('unpaid'),
          number(cls.kpis.unpaid),
          cls.kpis.unpaid === null ? t('pendingFees') : undefined,
        )}
        {card(
          t('attendance'),
          cls.kpis.avgAttendancePercent === null
            ? dash
            : `${Math.round(cls.kpis.avgAttendancePercent)}%`,
          cls.kpis.avgAttendancePercent === null ? t('pendingAttendance') : undefined,
        )}
      </ul>
    </section>
  );
}

/** Tab strip as links (works without JavaScript); the current tab is `aria-current="page"`. */
export async function ClassTabs({ classId, current }: { classId: string; current: ClassTab }) {
  const t = await getTranslations('classes.detail.tabs');
  return (
    <nav aria-label={t('label')} className="border-line overflow-x-auto border-b">
      <ul className="m-0 flex min-w-max list-none gap-1 p-0">
        {CLASS_TABS.map((tab) => (
          <li key={tab}>
            <Link
              href={classHref(classId, tab)}
              aria-current={tab === current ? 'page' : undefined}
              className={
                tab === current
                  ? 'border-brand text-brand -mb-px inline-flex min-h-11 items-center border-b-2 px-3 text-sm font-semibold'
                  : 'text-muted hover:text-ink inline-flex min-h-11 items-center px-3 text-sm font-medium'
              }
            >
              {t(tab)}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/** Schedule tab: the weekly times, where, and when the class starts. */
export async function ScheduleTab({ cls }: { cls: ClassDetail }) {
  const [t, tDay, format, locale] = await Promise.all([
    getTranslations('classes.detail.schedule'),
    getTranslations('classes.weekday'),
    getFormatter(),
    getLocale(),
  ]);
  const tClasses = await getTranslations('classes');
  const slots = sortedSchedule(cls.schedule);
  const columns: DataTableColumn<ClassSchedule>[] = [
    {
      id: 'day',
      header: t('day'),
      rowHeader: true,
      cell: (s) => tDay(String(s.weekday) as '1'),
    },
    {
      id: 'time',
      header: t('time'),
      cell: (s) =>
        tClasses('timeRange', {
          start: formatTime(s.startTime, locale),
          end: formatTime(endTime(s.startTime, s.durationMinutes), locale),
        }),
    },
    {
      id: 'length',
      header: t('length'),
      align: 'end',
      cell: (s) => tClasses('minutes', { count: s.durationMinutes }),
    },
  ];
  const facts = [
    cls.place === 'online' ? t('online') : cls.hallName ? t('hall', { hall: cls.hallName }) : null,
    cls.startsOn
      ? t('startsOn', {
          date: format.dateTime(new Date(`${cls.startsOn}T00:00:00+05:30`), {
            day: 'numeric',
            month: 'long',
            year: 'numeric',
          }),
        })
      : null,
  ].filter(Boolean);

  return (
    <section aria-labelledby="class-schedule-heading" className="flex flex-col gap-3">
      <h2 id="class-schedule-heading" className="m-0 text-lg font-semibold leading-6">
        {t('title')}
      </h2>
      {facts.length > 0 ? <p className="text-muted m-0 text-sm">{facts.join(' · ')}</p> : null}
      <div className="bg-surface border-line overflow-hidden rounded-lg border">
        <DataTable
          caption={t('caption')}
          columns={columns}
          rows={slots}
          rowKey={(s) => `${s.weekday}-${s.startTime}`}
          empty={
            <EmptyState
              size="compact"
              icon={<CalendarClock />}
              title={t('title')}
              description={t('empty')}
            />
          }
        />
      </div>
    </section>
  );
}

/** Lessons, Fees and Attendance exist in later phases: an honest empty state, no invented data. */
export async function LaterTab({ tab }: { tab: 'lessons' | 'fees' | 'attendance' }) {
  const t = await getTranslations('classes.detail.later');
  return (
    <EmptyState
      className="bg-surface border-line rounded-lg border"
      icon={<CalendarClock />}
      title={t(`${tab}.title`)}
      description={t(`${tab}.body`)}
    />
  );
}
