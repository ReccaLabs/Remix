import { StatCard, StatusBadge, buttonClass, DataTable, EmptyState } from '@remix/ui';
import type { StudentProfile } from '@remix/types/api';
import { CalendarCheck, ChevronLeft, CreditCard, Pencil, ShieldCheck } from 'lucide-react';
import Link from 'next/link';
import { getFormatter, getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import { initials } from '@/lib/initials';
import { ADMIN_PATHS } from '@/lib/paths';
import { currentMonth, formatPhone, STATUS_TONE } from '@/lib/people';
import { StudentLifecycle } from './student-lifecycle';

export const PROFILE_TABS = [
  'overview',
  'classes',
  'payments',
  'attendance',
  'devices',
  'parent',
] as const;
export type ProfileTab = (typeof PROFILE_TABS)[number];

export function parseTab(value: string | string[] | undefined, allowed: readonly ProfileTab[]) {
  const tab = Array.isArray(value) ? value[0] : value;
  return allowed.find((t) => t === tab) ?? 'overview';
}

const profileHref = (id: string, tab?: ProfileTab) =>
  tab && tab !== 'overview'
    ? `${ADMIN_PATHS.students}/${id}?tab=${tab}`
    : `${ADMIN_PATHS.students}/${id}`;

/** Profile header (12b): who, status and the actions the viewer may take. */
export async function StudentHeader({
  student,
  canWrite,
}: {
  student: StudentProfile;
  canWrite: boolean;
}) {
  const [t, tStatus, format] = await Promise.all([
    getTranslations('students.profile'),
    getTranslations('students.status'),
    getFormatter(),
  ]);
  const meta = [
    formatPhone(student.phone),
    student.school,
    t('joined', {
      date: format.dateTime(new Date(student.joinedAt), { month: 'short', year: 'numeric' }),
    }),
  ].filter(Boolean);

  return (
    <header className="flex flex-col gap-4">
      <Link
        href={ADMIN_PATHS.students}
        className="text-muted hover:text-ink inline-flex min-h-11 items-center gap-1 self-start text-sm"
      >
        <ChevronLeft aria-hidden size={16} />
        {t('back')}
      </Link>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 items-center gap-4">
          <span
            aria-hidden
            className="bg-brand-soft text-brand flex size-14 flex-none items-center justify-center rounded-full text-lg font-semibold"
          >
            {initials(student.displayName)}
          </span>
          <div className="flex min-w-0 flex-col gap-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="m-0 text-2xl font-semibold leading-8 tracking-[-0.015em]">
                {student.displayName}
              </h1>
              <StatusBadge tone={STATUS_TONE[student.status]}>
                {tStatus(student.status)}
              </StatusBadge>
            </div>
            <p className="m-0 break-all font-mono text-xl font-semibold">{student.studentNo}</p>
            <p className="text-muted m-0 text-sm">{meta.join(' · ')}</p>
          </div>
        </div>
        {canWrite ? (
          <div className="flex flex-wrap gap-2">
            <Link
              href={`${ADMIN_PATHS.students}/${student.id}/edit`}
              className={buttonClass({ variant: 'secondary' })}
            >
              <Pencil aria-hidden size={16} />
              {t('edit')}
            </Link>
            <StudentLifecycle
              studentId={student.id}
              name={student.displayName}
              archived={student.status === 'archived'}
            />
          </div>
        ) : null}
      </div>
    </header>
  );
}

/** Tab strip as links (works without JavaScript); the current tab is `aria-current="page"`. */
export async function StudentTabs({
  studentId,
  current,
  tabs,
}: {
  studentId: string;
  current: ProfileTab;
  tabs: readonly ProfileTab[];
}) {
  const t = await getTranslations('students.profile.tabs');
  return (
    <nav aria-label={t('label')} className="border-line overflow-x-auto border-b">
      <ul className="m-0 flex min-w-max list-none gap-1 p-0">
        {tabs.map((tab) => (
          <li key={tab}>
            <Link
              href={profileHref(studentId, tab)}
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

const NO_VALUE = '—';

function Dash({ label }: { label: string }): ReactNode {
  return (
    <>
      <span aria-hidden>{NO_VALUE}</span>
      <span className="sr-only">{label}</span>
    </>
  );
}

export async function OverviewTab({ student }: { student: StudentProfile }) {
  const [t, format] = await Promise.all([
    getTranslations('students.profile.overview'),
    getFormatter(),
  ]);
  const month = currentMonth();
  const current = student.enrollments.filter(
    (e) => e.fromMonth <= month && (e.toMonth === null || e.toMonth >= month),
  );
  const guardian = student.guardians[0];
  const later = t('later');
  return (
    <div className="flex flex-col gap-6">
      <section aria-label={t('statsLabel')} className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label={t('owes')}
          value={
            student.overview.owesCents === null ? (
              <Dash label={later} />
            ) : (
              format.number(student.overview.owesCents / 100, {
                style: 'currency',
                currency: 'LKR',
              })
            )
          }
          context={t('owesContext')}
        />
        <StatCard
          label={t('paid')}
          value={
            student.overview.paidThisYearCents === null ? (
              <Dash label={later} />
            ) : (
              format.number(student.overview.paidThisYearCents / 100, {
                style: 'currency',
                currency: 'LKR',
              })
            )
          }
          context={t('paidContext')}
        />
        <StatCard
          label={t('attendance')}
          value={
            student.overview.attendancePercent === null ? (
              <Dash label={later} />
            ) : (
              `${student.overview.attendancePercent}%`
            )
          }
          context={t('attendanceContext')}
        />
        <StatCard
          label={t('lessons')}
          value={
            student.overview.lessonsWatched === null ? (
              <Dash label={later} />
            ) : (
              student.overview.lessonsWatched
            )
          }
          context={t('lessonsContext')}
        />
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <section aria-labelledby="ov-classes" className="flex flex-col gap-3">
          <h2 id="ov-classes" className="m-0 text-base font-semibold">
            {t('classes')}
          </h2>
          {current.length === 0 ? (
            <p className="text-muted m-0 text-sm">{t('noClasses')}</p>
          ) : (
            <ul className="bg-surface border-line m-0 list-none divide-y rounded-lg border p-0">
              {current.map((e) => (
                <li
                  key={e.id}
                  className="flex items-center justify-between gap-3 px-4 py-3 text-sm"
                >
                  <span className="font-medium">{e.className}</span>
                  <span className="text-muted">
                    {t('since', {
                      date: format.dateTime(new Date(`${e.fromMonth}T00:00:00+05:30`), {
                        month: 'short',
                        year: 'numeric',
                      }),
                    })}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section aria-labelledby="ov-parent" className="flex flex-col gap-3">
          <h2 id="ov-parent" className="m-0 text-base font-semibold">
            {t('parent')}
          </h2>
          {guardian ? (
            <div className="bg-surface border-line rounded-lg border px-4 py-3 text-sm">
              <p className="m-0 font-medium">{guardian.name}</p>
              <p className="text-muted m-0">{formatPhone(guardian.phone)}</p>
            </div>
          ) : (
            <p className="text-muted m-0 text-sm">{t('noParent')}</p>
          )}
        </section>
      </div>
    </div>
  );
}

export async function ClassesTab({ student }: { student: StudentProfile }) {
  const [t, format] = await Promise.all([
    getTranslations('students.profile.classesTab'),
    getFormatter(),
  ]);
  const month = (m: string) =>
    format.dateTime(new Date(`${m}T00:00:00+05:30`), { month: 'short', year: 'numeric' });
  return (
    <div className="bg-surface border-line overflow-hidden rounded-lg border">
      <DataTable
        caption={t('caption')}
        rows={student.enrollments}
        rowKey={(e) => e.id}
        columns={[
          { id: 'class', header: t('columns.class'), cell: (e) => e.className, rowHeader: true },
          { id: 'from', header: t('columns.from'), cell: (e) => month(e.fromMonth) },
          {
            id: 'to',
            header: t('columns.to'),
            cell: (e) => (e.toMonth ? month(e.toMonth) : t('ongoing')),
          },
          {
            id: 'fee',
            header: t('columns.fee'),
            align: 'end',
            cell: (e) => format.number(e.feeCents / 100, { style: 'currency', currency: 'LKR' }),
          },
          {
            id: 'note',
            header: t('columns.note'),
            wrap: true,
            cell: (e) =>
              e.feeOverrideCents === null ? (
                NO_VALUE
              ) : (
                <StatusBadge tone="info">{e.reason ?? t('override')}</StatusBadge>
              ),
          },
        ]}
        empty={<EmptyState size="compact" title={t('empty.title')} description={t('empty.body')} />}
      />
    </div>
  );
}

/** Payments and Attendance: figures arrive with Phases 3 and 5 — explain, don't invent. */
export async function LaterTab({ tab }: { tab: 'payments' | 'attendance' }) {
  const t = await getTranslations(`students.profile.later.${tab}`);
  return (
    <EmptyState
      className="bg-surface border-line rounded-lg border"
      icon={tab === 'payments' ? <CreditCard /> : <CalendarCheck />}
      title={t('title')}
      description={t('body')}
    />
  );
}

export async function ParentTab({ student }: { student: StudentProfile }) {
  const [t, format] = await Promise.all([
    getTranslations('students.profile.parentTab'),
    getFormatter(),
  ]);
  return (
    <div className="flex flex-col gap-6">
      <section aria-labelledby="guardians-heading" className="flex flex-col gap-3">
        <h2 id="guardians-heading" className="m-0 text-base font-semibold">
          {t('guardians')}
        </h2>
        <div className="bg-surface border-line overflow-hidden rounded-lg border">
          <DataTable
            caption={t('caption')}
            rows={student.guardians}
            rowKey={(g) => g.id}
            columns={[
              { id: 'name', header: t('columns.name'), cell: (g) => g.name, rowHeader: true },
              {
                id: 'relation',
                header: t('columns.relation'),
                cell: (g) => t(`relations.${g.relation}`),
              },
              { id: 'phone', header: t('columns.phone'), cell: (g) => formatPhone(g.phone) },
              {
                id: 'sms',
                header: t('columns.sms'),
                cell: (g) => (
                  <StatusBadge tone={g.smsOptIn ? 'success' : 'neutral'}>
                    {g.smsOptIn ? t('smsOn') : t('smsOff')}
                  </StatusBadge>
                ),
              },
            ]}
            empty={
              <EmptyState size="compact" title={t('empty.title')} description={t('empty.body')} />
            }
          />
        </div>
      </section>
      <section aria-labelledby="consent-heading" className="flex flex-col gap-3">
        <h2 id="consent-heading" className="m-0 text-base font-semibold">
          {t('consent')}
        </h2>
        <div className="bg-surface border-line flex items-start gap-3 rounded-lg border px-4 py-3 text-sm">
          <ShieldCheck aria-hidden size={20} className="text-muted mt-0.5 flex-none" />
          <p className="m-0">
            {student.consent
              ? t('consentGiven', {
                  givenBy: student.consent.givenBy,
                  method: t(`methods.${student.consent.method}`),
                  date: format.dateTime(new Date(student.consent.recordedAt), {
                    day: 'numeric',
                    month: 'short',
                    year: 'numeric',
                  }),
                })
              : student.under18
                ? t('consentMissing')
                : t('consentNotNeeded')}
          </p>
        </div>
      </section>
    </div>
  );
}
