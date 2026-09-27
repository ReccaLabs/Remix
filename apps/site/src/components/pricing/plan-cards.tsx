import { buttonClass, cn } from '@remix/ui';
import { formatStorage, PLAN_LIMITS, PLANS } from '@remix/types';
import { Check } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import { Link } from '@/i18n/navigation';
import { ROUTES } from '@/lib/site';
import { PlanPrice } from './billing';

const num = new Intl.NumberFormat('en-US');

function Feature({ children }: { children: ReactNode }) {
  return (
    <li className="flex gap-2.5">
      <Check
        size={18}
        aria-hidden
        className="text-success in-data-[tone=dark]:text-success-on-dark mt-[3px] flex-none"
      />
      <span>{children}</span>
    </li>
  );
}

const card = 'flex flex-col gap-6 rounded-card p-6 xl:p-8';
const light = 'bg-surface border-line-warm border';
const list = 'm-0 flex list-none flex-col gap-3 p-0 pt-5 text-[15px] border-t';

/** The three plan cards. Prices come from @remix/types; only <PlanPrice> is client-side. */
export async function PlanCards() {
  const t = await getTranslations('pricing.plans');
  const outline = buttonClass({ variant: 'outline', className: 'w-full' });

  return (
    <section aria-labelledby="plans-title">
      <h2 id="plans-title" className="sr-only">
        {t('title')}
      </h2>
      <div className="lg:max-w-marketing mx-auto grid w-full max-w-[560px] gap-4 px-4 pb-16 pt-6 sm:px-6 sm:pb-24 lg:grid-cols-3">
        {/* Tutor */}
        <article aria-labelledby="plan-tutor" className={cn(card, light)}>
          <div className="flex flex-col gap-1.5">
            <h3 id="plan-tutor" className="m-0 text-[22px] font-semibold leading-7">
              {t('tutor.name')}
            </h3>
            <span className="text-muted">
              {t('tutor.audience', {
                teachers: PLAN_LIMITS.tutor.teachers,
                max: num.format(PLANS.tutor.maxStudents),
              })}
            </span>
          </div>
          <PlanPrice plan="tutor" />
          <Link href={ROUTES.trial} className={outline}>
            {t('tutor.cta')}
          </Link>
          <ul className={cn(list, 'border-line-warm-soft')}>
            <Feature>{t('tutor.features.classes')}</Feature>
            <Feature>{t('tutor.features.payments')}</Feature>
            <Feature>{t('tutor.features.zoom')}</Feature>
            <Feature>{t('tutor.features.video')}</Feature>
            <Feature>
              {t('tutor.features.storage', { storage: formatStorage(PLAN_LIMITS.tutor.storageGB) })}
            </Feature>
            <Feature>{t('tutor.features.website')}</Feature>
          </ul>
        </article>

        {/* Institute (highlighted) */}
        <article
          aria-labelledby="plan-institute"
          className={cn(card, 'bg-night shadow-card-strong text-white')}
        >
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between gap-3">
              <h3 id="plan-institute" className="m-0 text-[22px] font-semibold leading-7">
                {t('institute.name')}
              </h3>
              <span className="bg-accent-on-dark text-ink flex h-6 items-center rounded-full px-2.5 text-xs font-bold">
                {t('institute.popular')}
              </span>
            </div>
            <span className="text-night-muted">
              {t('institute.audience', { max: num.format(PLANS.institute.maxStudents) })}
            </span>
          </div>
          <PlanPrice plan="institute" dark />
          <Link href={ROUTES.trial} className={buttonClass({ className: 'w-full' })}>
            {t('institute.cta')}
          </Link>
          <ul data-tone="dark" className={cn(list, 'border-night-line')}>
            <li className="text-night-muted">{t('institute.includes')}</li>
            <Feature>{t('institute.features.teachers')}</Feature>
            <Feature>
              {t('institute.features.cashiers', { count: PLAN_LIMITS.institute.cashierLogins })}
            </Feature>
            <Feature>{t('institute.features.qr')}</Feature>
            <Feature>{t('institute.features.exams')}</Feature>
            <Feature>{t('institute.features.domain')}</Feature>
            <Feature>
              {t('institute.features.storage', {
                storage: formatStorage(PLAN_LIMITS.institute.storageGB),
              })}
            </Feature>
          </ul>
        </article>

        {/* Enterprise */}
        <article
          id="enterprise"
          aria-labelledby="plan-enterprise"
          className={cn(card, light, 'scroll-mt-24')}
        >
          <div className="flex flex-col gap-1.5">
            <h3 id="plan-enterprise" className="m-0 text-[22px] font-semibold leading-7">
              {t('enterprise.name')}
            </h3>
            <span className="text-muted">
              {t('enterprise.audience', { min: num.format(PLANS.institute.maxStudents) })}
            </span>
          </div>
          <PlanPrice plan="enterprise" />
          <Link href={ROUTES.demo} className={outline}>
            {t('enterprise.cta')}
          </Link>
          <ul className={cn(list, 'border-line-warm-soft')}>
            <li className="text-muted">{t('enterprise.includes')}</li>
            <Feature>{t('enterprise.features.app')}</Feature>
            <Feature>{t('enterprise.features.reports')}</Feature>
            <Feature>{t('enterprise.features.support')}</Feature>
            <Feature>
              {t('enterprise.features.storage', {
                storage: formatStorage(PLAN_LIMITS.enterprise.storageGB),
              })}
            </Feature>
          </ul>
        </article>
      </div>
    </section>
  );
}
