import { DataTable, EmptyState, StatusBadge, buttonClass, type DataTableColumn } from '@remix/ui';
import type { AdminClass, ClassSchedule } from '@remix/types/api';
import { BookOpen, ChevronRight } from 'lucide-react';
import Link from 'next/link';
import { getFormatter, getLocale, getTranslations } from 'next-intl/server';
import { ADMIN_PATHS } from '@/lib/paths';
import { formatFee } from '@/lib/classes';
import { formatSlot, sortedSchedule } from '@/lib/schedule';

/**
 * Classes list (Admin Classes 8a desktop table, 8d phone cards). Server-rendered: the filters
 * are the URL, so the list needs no client state. Money and attendance columns show "—" until
 * Phases 3/5 provide the numbers.
 */
export async function ClassesList({
  items,
  filtered,
  clearHref,
  canWrite,
}: {
  items: readonly AdminClass[];
  filtered: boolean;
  clearHref: string;
  canWrite: boolean;
}) {
  const [t, format, locale] = await Promise.all([
    getTranslations('classes'),
    getFormatter(),
    getLocale(),
  ]);

  const slotText = (slot: ClassSchedule) => {
    const { weekday, time } = formatSlot(slot, locale);
    return t('slot', { weekday, time });
  };
  const scheduleText = (c: AdminClass) => {
    const slots = sortedSchedule(c.schedule);
    const [first] = slots;
    if (!first) return t('list.noSchedule');
    return slots.length === 1 ? slotText(first) : `${slotText(first)} +${slots.length - 1}`;
  };
  const placeText = (c: AdminClass) =>
    t('placeValue', { place: c.place, hall: c.hallName ?? t('hallFallback') });
  const pending = (
    <>
      <span aria-hidden>—</span>
      <span className="sr-only">{t('list.paidPending')}</span>
    </>
  );
  const archivedBadge = (c: AdminClass) =>
    c.archivedAt ? <StatusBadge tone="neutral">{t('list.archivedBadge')}</StatusBadge> : null;

  const empty = filtered ? (
    <EmptyState
      size="compact"
      icon={<BookOpen />}
      title={t('list.emptyFiltered.title')}
      description={t('list.emptyFiltered.body')}
      action={
        <Link href={clearHref} className="text-brand text-sm font-medium underline">
          {t('list.emptyFiltered.clear')}
        </Link>
      }
    />
  ) : (
    <EmptyState
      size="compact"
      icon={<BookOpen />}
      title={t('list.empty.title')}
      description={t('list.empty.body')}
      action={
        canWrite ? (
          <Link href={`${ADMIN_PATHS.classes}/new`} className={buttonClass({ variant: 'primary' })}>
            {t('list.create')}
          </Link>
        ) : undefined
      }
    />
  );

  const columns: DataTableColumn<AdminClass>[] = [
    {
      id: 'name',
      header: t('list.columns.name'),
      rowHeader: true,
      cell: (c) => (
        <span className="inline-flex flex-wrap items-center gap-2">
          {c.name}
          {archivedBadge(c)}
        </span>
      ),
    },
    {
      id: 'teacher',
      header: t('list.columns.teacher'),
      cell: (c) => c.teacherName ?? <span aria-label={t('list.noTeacher')}>—</span>,
    },
    { id: 'schedule', header: t('list.columns.schedule'), cell: scheduleText },
    { id: 'place', header: t('list.columns.place'), cell: placeText },
    {
      id: 'students',
      header: t('list.columns.students'),
      align: 'end',
      cell: (c) => format.number(c.studentCount),
    },
    {
      id: 'fee',
      header: t('list.columns.fee'),
      align: 'end',
      cell: (c) =>
        format.number(c.feeCents / 100, { minimumFractionDigits: c.feeCents % 100 === 0 ? 0 : 2 }),
    },
    { id: 'paid', header: t('list.columns.paid'), align: 'end', cell: () => pending },
  ];

  return (
    <>
      <div className="bg-surface border-line hidden overflow-hidden rounded-lg border lg:block">
        <DataTable
          caption={t('list.tableCaption')}
          columns={columns}
          rows={items}
          rowKey={(c) => c.id}
          rowHref={(c) => `${ADMIN_PATHS.classes}/${c.id}`}
          linkComponent={Link}
          empty={empty}
        />
      </div>

      <div className="lg:hidden">
        {items.length === 0 ? (
          <div className="bg-surface border-line rounded-lg border">{empty}</div>
        ) : (
          <ul aria-label={t('list.cardsLabel')} className="m-0 flex list-none flex-col gap-2.5 p-0">
            {items.map((c) => (
              <li key={c.id}>
                <Link
                  href={`${ADMIN_PATHS.classes}/${c.id}`}
                  className="bg-surface border-line hover:border-brand flex min-h-11 items-center gap-3 rounded-lg border p-4"
                >
                  <span className="flex min-w-0 flex-1 flex-col gap-1">
                    <span className="flex flex-wrap items-center gap-2 font-semibold">
                      {c.name}
                      {archivedBadge(c)}
                    </span>
                    <span className="text-muted text-sm">
                      {scheduleText(c)} · {placeText(c)}
                    </span>
                    <span className="text-muted text-sm">
                      {t('list.studentsValue', { count: c.studentCount })} · {formatFee(c.feeCents)}
                    </span>
                  </span>
                  <ChevronRight aria-hidden size={18} className="text-muted flex-none" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}
