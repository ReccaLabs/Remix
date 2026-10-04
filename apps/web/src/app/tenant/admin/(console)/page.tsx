import { buttonClass, EmptyState, StatCard } from '@remix/ui';
import {
  BookOpen,
  CalendarDays,
  CircleAlert,
  CircleCheck,
  Clock,
  Mail,
  UserCog,
  Users,
  Wallet,
} from 'lucide-react';
import Link from 'next/link';
import { getFormatter, getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import { SlotCard } from '@/components/classes/timetable-week';
import { PageBody } from '@/components/shell/page-body';
import { firstName } from '@/lib/initials';
import { ADMIN_PATHS } from '@/lib/paths';
import { greetingPeriod } from '@/lib/schedule';
import { requireStaff } from '@/server/api';
import { loadDashboard } from '@/server/classes';
import { adminMetadata } from '@/server/metadata';
import { formatRoles } from '@/server/staff';

/**
 * Admin home (Institute Dashboard B5 desktop, Admin Dashboard Mobile 17a). The counts and
 * "Today's classes" are real (students, classes, staff, the timetable). The money and attendance
 * cards keep the design's layout but show "—" until fees and attendance exist — no invented numbers.
 */

export const generateMetadata = () => adminMetadata('dashboard');

export default async function AdminDashboardPage() {
  const session = await requireStaff();
  const [t, format, roles, dashboard] = await Promise.all([
    getTranslations('admin.dashboard'),
    getFormatter(),
    formatRoles(session.user.roles),
    loadDashboard(),
  ]);
  const now = new Date();

  const notAvailable: ReactNode = (
    <>
      <span aria-hidden>—</span>
      <span className="sr-only">{t('notAvailable')}</span>
    </>
  );

  return (
    <PageBody width="admin">
      <div className="flex flex-col gap-1">
        <h1 className="m-0 text-2xl font-semibold leading-8 tracking-[-0.015em]">
          {t('greeting', {
            period: greetingPeriod(now),
            name: firstName(session.user.displayName),
          })}
        </h1>
        <p className="text-muted m-0">
          {t('signedInAs', {
            date: format.dateTime(now, {
              weekday: 'short',
              day: 'numeric',
              month: 'short',
              year: 'numeric',
            }),
            roles,
          })}
        </p>
      </div>

      {dashboard.ok ? (
        <section aria-labelledby="counts-heading" className="flex flex-col gap-3">
          <h2 id="counts-heading" className="sr-only">
            {t('counts.label')}
          </h2>
          <ul className="m-0 grid list-none grid-cols-2 gap-2.5 p-0 lg:grid-cols-4 lg:gap-4">
            <li>
              <StatCard
                className="h-full"
                icon={<Users />}
                label={t('counts.activeStudents')}
                value={format.number(dashboard.data.counts.activeStudents)}
                detail={{
                  text: t('counts.newThisMonth', {
                    count: dashboard.data.counts.newStudentsThisMonth,
                  }),
                }}
              />
            </li>
            <li>
              <StatCard
                className="h-full"
                icon={<Mail />}
                label={t('counts.invitedStudents')}
                value={format.number(dashboard.data.counts.invitedStudents)}
              />
            </li>
            <li>
              <StatCard
                className="h-full"
                icon={<BookOpen />}
                label={t('counts.classes')}
                value={format.number(dashboard.data.counts.classes)}
              />
            </li>
            {dashboard.data.counts.staff > 0 ? (
              <li>
                <StatCard
                  className="h-full"
                  icon={<UserCog />}
                  label={t('counts.staff')}
                  value={format.number(dashboard.data.counts.staff)}
                />
              </li>
            ) : null}
          </ul>
        </section>
      ) : null}

      <section aria-labelledby="stats-heading" className="flex flex-col gap-3">
        <h2 id="stats-heading" className="sr-only">
          {t('statsLabel')}
        </h2>
        <ul className="m-0 grid list-none grid-cols-2 gap-2.5 p-0 lg:grid-cols-4 lg:gap-4">
          <li className="col-span-2 lg:col-span-1">
            <StatCard
              className="h-full"
              icon={<Wallet />}
              label={t('feesCollected')}
              value={notAvailable}
              detail={{ text: t('statPending') }}
            />
          </li>
          <li>
            <StatCard
              className="h-full"
              icon={<Users />}
              label={t('unpaidStudents')}
              value={notAvailable}
              detail={{ text: t('statPending') }}
            />
          </li>
          <li>
            <StatCard
              className="h-full"
              icon={<Clock />}
              label={t('bankSlips')}
              value={notAvailable}
              detail={{ text: t('statPending') }}
            />
          </li>
          <li className="col-span-2 lg:col-span-1">
            <StatCard
              className="h-full"
              icon={<CircleCheck />}
              label={t('presentToday')}
              value={notAvailable}
              detail={{ text: t('attendancePending') }}
            />
          </li>
        </ul>
        <p className="text-muted m-0 text-[13px]">{t('note')}</p>
      </section>

      <section aria-labelledby="today-heading" className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="today-heading" className="m-0 text-lg font-semibold leading-6">
            {t('today.title')}
          </h2>
          <Link href={ADMIN_PATHS.timetable} className={buttonClass({ variant: 'secondary' })}>
            <CalendarDays aria-hidden size={16} />
            {t('today.timetable')}
          </Link>
        </div>
        {dashboard.ok ? (
          dashboard.data.todaysClasses.length === 0 ? (
            <EmptyState
              className="bg-surface border-line rounded-lg border"
              size="compact"
              icon={<CalendarDays />}
              title={t('today.empty.title')}
              description={t('today.empty.body')}
            />
          ) : (
            <ul
              aria-label={t('today.label')}
              className="m-0 grid list-none gap-2.5 p-0 sm:grid-cols-2 lg:grid-cols-3"
            >
              {dashboard.data.todaysClasses.map((slot) => (
                <li key={`${slot.classId}-${slot.startTime}`}>
                  <SlotCard slot={slot} />
                </li>
              ))}
            </ul>
          )
        ) : (
          <EmptyState
            className="bg-surface border-line rounded-lg border"
            size="compact"
            icon={<CircleAlert />}
            title={t('today.loadError')}
            action={
              <a href={ADMIN_PATHS.home} className={buttonClass({ variant: 'secondary' })}>
                {t('today.retry')}
              </a>
            }
          />
        )}
      </section>
    </PageBody>
  );
}
