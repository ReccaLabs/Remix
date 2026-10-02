import { StatCard } from '@remix/ui';
import { CircleCheck, Clock, Users, Wallet } from 'lucide-react';
import { getFormatter, getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import { PageBody } from '@/components/shell/page-body';
import { firstName } from '@/lib/initials';
import { greetingPeriod } from '@/lib/schedule';
import { requireStaff } from '@/server/api';
import { adminMetadata } from '@/server/metadata';
import { formatRoles } from '@/server/staff';

/**
 * Admin home skeleton (Institute Dashboard B5 desktop, Admin Dashboard Mobile 17a). The cards
 * keep the design's layout but show "—" until fees and attendance exist — no invented numbers.
 */

export const generateMetadata = () => adminMetadata('dashboard');

export default async function AdminDashboardPage() {
  const session = await requireStaff();
  const [t, format, roles] = await Promise.all([
    getTranslations('admin.dashboard'),
    getFormatter(),
    formatRoles(session.user.roles),
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
    </PageBody>
  );
}
