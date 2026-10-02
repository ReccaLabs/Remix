import { EmptyState } from '@remix/ui';
import type { ClassSummary } from '@remix/types/api';
import { BookOpen, ChevronRight } from 'lucide-react';
import Link from 'next/link';
import { getFormatter, getLocale, getTranslations } from 'next-intl/server';
import { LoadError } from '@/components/portal/load-error';
import { PageBody } from '@/components/shell/page-body';
import { firstName } from '@/lib/initials';
import { PORTAL_PATHS } from '@/lib/paths';
import { formatSlot, slotsToday, sortedSchedule } from '@/lib/schedule';
import { requireStudent } from '@/server/api';
import { portalMetadata } from '@/server/metadata';
import { loadMyClasses } from '@/server/portal';

/**
 * Student Home 2a/2b, Phase 1 slice: greeting, today's classes and a "Your classes" summary.
 * Live now, fees due, continue watching and teacher notices arrive with their features.
 */

export const generateMetadata = () => portalMetadata('home');

export default async function PortalHomePage() {
  const session = await requireStudent();
  const [result, t, format, locale] = await Promise.all([
    loadMyClasses(),
    getTranslations('portal'),
    getFormatter(),
    getLocale(),
  ]);
  const now = new Date();

  return (
    <>
      <div className="bg-brand lg:text-ink text-white lg:bg-transparent">
        <div className="mx-auto flex max-w-6xl flex-col gap-0.5 px-4 pb-6 pt-5 lg:px-10 lg:pb-0 lg:pt-8">
          <h1 className="m-0 text-[28px] font-semibold leading-[34px] tracking-[-0.02em] lg:text-[26px] lg:leading-8">
            {t('home.greeting', { name: firstName(session.user.displayName) })}
          </h1>
          <p className="lg:text-muted m-0 text-sm opacity-90 lg:text-base lg:opacity-100">
            {format.dateTime(now, { weekday: 'short', day: 'numeric', month: 'short' })}
          </p>
        </div>
      </div>

      <PageBody>
        {!result.ok ? (
          <LoadError retryHref={PORTAL_PATHS.home} />
        ) : (
          <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] lg:gap-5">
            <TodayCard classes={result.items} now={now} locale={locale} />
            <YourClasses classes={result.items} locale={locale} />
          </div>
        )}
      </PageBody>
    </>
  );
}

async function TodayCard({
  classes,
  now,
  locale,
}: {
  classes: ClassSummary[];
  now: Date;
  locale: string;
}) {
  const t = await getTranslations('portal');
  const today = slotsToday(classes, now);
  return (
    <section aria-labelledby="today-heading" className="flex flex-col gap-1">
      <h2 id="today-heading" className="m-0 flex min-h-11 items-center text-base font-semibold">
        {t('home.today')}
      </h2>
      <div className="bg-surface border-line rounded-lg border">
        {today.length === 0 ? (
          <p className="text-muted m-0 px-4 py-4">{t('home.noClassesToday')}</p>
        ) : (
          <ul className="m-0 list-none p-0">
            {today.map(({ classId, className, place, slot }) => (
              <li
                key={`${classId}-${slot.startTime}`}
                className="border-line-soft flex gap-3 border-b px-4 py-3 last:border-b-0"
              >
                <span className="tabular w-[72px] flex-none font-semibold">
                  {formatSlot(slot, locale).time}
                </span>
                <span className="flex min-w-0 flex-col">
                  <span className="font-medium">{className}</span>
                  <span className="text-muted text-[13px]">{t(`place.${place}`)}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

async function YourClasses({ classes, locale }: { classes: ClassSummary[]; locale: string }) {
  const t = await getTranslations('portal');
  return (
    <section aria-labelledby="classes-heading" className="flex flex-col gap-1">
      <div className="flex min-h-11 items-center justify-between gap-3">
        <h2 id="classes-heading" className="m-0 text-base font-semibold">
          {t('home.yourClasses')}
        </h2>
        {classes.length > 0 ? (
          <Link
            href={PORTAL_PATHS.classes}
            className="inline-flex min-h-11 items-center text-sm font-medium"
          >
            {t('home.seeAll')}
          </Link>
        ) : null}
      </div>
      {classes.length === 0 ? (
        <EmptyState
          className="bg-surface border-line rounded-lg border"
          headingLevel={3}
          icon={<BookOpen />}
          title={t('home.emptyTitle')}
          description={t('home.emptyBody')}
        />
      ) : (
        <ul className="bg-surface border-line m-0 list-none rounded-lg border p-0">
          {classes.map((cls) => {
            const first = sortedSchedule(cls.schedule)[0];
            const when = first ? formatSlot(first, locale) : null;
            return (
              <li key={cls.id} className="border-line-soft border-b last:border-b-0">
                <Link
                  href={PORTAL_PATHS.classes}
                  className="text-ink hover:bg-canvas hover:text-ink flex min-h-14 items-center gap-3 px-4 py-3 hover:no-underline"
                >
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="font-medium">{cls.name}</span>
                    <span className="text-muted text-[13px]">
                      {t('home.classLine', {
                        when: when ? t('classes.slot', when) : t('classes.noSchedule'),
                        medium: t(`medium.${cls.medium}`),
                      })}
                    </span>
                  </span>
                  <ChevronRight aria-hidden size={18} className="text-muted flex-none" />
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
