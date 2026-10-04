'use client';

import { Button, DataTable, EmptyState, StatusBadge, type DataTableColumn } from '@remix/ui';
import type { ClassStudent } from '@remix/types/api';
import { CalendarX, Pencil, MoveRight, UserPlus, Users } from 'lucide-react';
import Link from 'next/link';
import { useFormatter, useTranslations } from 'next-intl';
import { useState } from 'react';
import { ADMIN_PATHS } from '@/lib/paths';
import { currentMonth, formatPhone, monthDate } from '@/lib/people';
import { formatFee } from '@/lib/classes';
import { EndDialog, EnrolDialog, FeeDialog, MoveDialog } from './class-student-dialogs';

/**
 * Students tab of a class (Admin Classes 8c): who is enrolled, at what fee, and the actions
 * (add, change fee with a reason, move, end) for roles with `enrollments.write`. Students whose
 * enrolment ended before this month are not listed; an archived class takes no new students.
 */
export function ClassStudentsPanel({
  classId,
  className,
  classFeeCents,
  students,
  moveTargets,
  canEnrol,
  archived,
}: {
  classId: string;
  className: string;
  classFeeCents: number;
  students: readonly ClassStudent[];
  /** Classes a student can be moved to. */
  moveTargets: readonly { id: string; name: string }[];
  canEnrol: boolean;
  archived: boolean;
}) {
  const t = useTranslations('classes.students');
  const format = useFormatter();
  const [adding, setAdding] = useState(false);
  const [feeFor, setFeeFor] = useState<ClassStudent | null>(null);
  const [moveFor, setMoveFor] = useState<ClassStudent | null>(null);
  const [endFor, setEndFor] = useState<ClassStudent | null>(null);
  const month = currentMonth();
  const monthLabel = (m: string) =>
    format.dateTime(monthDate(m), { month: 'short', year: 'numeric' });

  const columns: DataTableColumn<ClassStudent>[] = [
    {
      id: 'name',
      header: t('columns.name'),
      rowHeader: true,
      cell: (s) => (
        <Link
          href={`${ADMIN_PATHS.students}/${s.studentId}`}
          className="text-brand font-medium hover:underline"
        >
          {s.displayName}
        </Link>
      ),
    },
    { id: 'studentNo', header: t('columns.studentNo'), cell: (s) => s.studentNo },
    { id: 'phone', header: t('columns.phone'), cell: (s) => formatPhone(s.phone) },
    {
      id: 'from',
      header: t('columns.from'),
      cell: (s) => (
        <span className="inline-flex flex-wrap items-center gap-2">
          {monthLabel(s.fromMonth)}
          {s.fromMonth > month ? (
            <StatusBadge tone="info">
              {t('upcoming', { month: monthLabel(s.fromMonth) })}
            </StatusBadge>
          ) : null}
          {s.toMonth ? (
            <StatusBadge tone="warning">{t('ends', { month: monthLabel(s.toMonth) })}</StatusBadge>
          ) : null}
        </span>
      ),
    },
    {
      id: 'fee',
      header: t('columns.fee'),
      align: 'end',
      cell: (s) => (
        <span className="inline-flex flex-wrap items-center justify-end gap-2">
          {formatFee(s.feeCents)}
          {s.feeOverrideCents !== null ? (
            <span title={s.reason ? t('customFeeTitle', { reason: s.reason }) : undefined}>
              <StatusBadge tone="warning">{t('customFee')}</StatusBadge>
            </span>
          ) : null}
        </span>
      ),
    },
    ...(canEnrol && !archived
      ? [
          {
            id: 'actions',
            header: t('columns.actions'),
            hideHeader: true,
            align: 'end',
            cell: (s: ClassStudent) => (
              <span className="inline-flex gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={t('changeFeeFor', { name: s.displayName })}
                  onClick={() => setFeeFor(s)}
                >
                  <Pencil aria-hidden size={16} />
                </Button>
                {moveTargets.length > 0 ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={t('moveFor', { name: s.displayName })}
                    onClick={() => setMoveFor(s)}
                  >
                    <MoveRight aria-hidden size={16} />
                  </Button>
                ) : null}
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={t('endFor', { name: s.displayName })}
                  onClick={() => setEndFor(s)}
                >
                  <CalendarX aria-hidden size={16} />
                </Button>
              </span>
            ),
          } satisfies DataTableColumn<ClassStudent>,
        ]
      : []),
  ];

  return (
    <section aria-labelledby="class-students-heading" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="class-students-heading" className="m-0 text-lg font-semibold leading-6">
          {t('title')}
        </h2>
        {canEnrol && !archived ? (
          <Button onClick={() => setAdding(true)}>
            <UserPlus aria-hidden size={16} />
            {t('add')}
          </Button>
        ) : null}
      </div>
      {archived ? <p className="text-muted m-0 text-sm">{t('archivedNote')}</p> : null}

      <div className="bg-surface border-line overflow-hidden rounded-lg border">
        <DataTable
          caption={t('tableCaption')}
          columns={columns}
          rows={students}
          rowKey={(s) => s.enrollmentId}
          empty={
            <EmptyState
              size="compact"
              icon={<Users />}
              title={t('empty.title')}
              description={t('empty.body')}
            />
          }
        />
      </div>

      <EnrolDialog
        open={adding}
        classId={classId}
        className={className}
        enrolledIds={new Set(students.map((s) => s.studentId))}
        onClose={() => setAdding(false)}
      />
      <FeeDialog
        key={`fee-${feeFor?.enrollmentId ?? 'none'}`}
        student={feeFor}
        classFeeCents={classFeeCents}
        onClose={() => setFeeFor(null)}
      />
      <MoveDialog
        key={`move-${moveFor?.enrollmentId ?? 'none'}`}
        student={moveFor}
        classes={moveTargets}
        onClose={() => setMoveFor(null)}
      />
      <EndDialog
        key={`end-${endFor?.enrollmentId ?? 'none'}`}
        student={endFor}
        onClose={() => setEndFor(null)}
      />
    </section>
  );
}
