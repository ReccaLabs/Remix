'use client';

import { buttonClass, cn } from '@remix/ui';
import { CARD_PRICING_DEFAULTS, compare, formatLKR } from '@remix/types';
import { TrendingDown } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useId, useState } from 'react';
import { Link } from '@/i18n/navigation';
import { ROUTES } from '@/lib/site';

const COUNTS = [100, 300, 1000, 2500] as const;
const num = new Intl.NumberFormat('en-US');

/**
 * Home-page calculator: pick a student count, compare ReMix vs per-class-card pricing.
 * Numbers come only from @remix/types/pricing. Radio inputs keep it keyboard/screen-reader native.
 */
export function PricingCalculator() {
  const t = useTranslations('home.pricing');
  const [students, setStudents] = useState<number>(300);
  const name = useId();
  const { quote, cardTotal, savings } = compare(students);
  const { plan } = quote;

  return (
    <>
      <div className="flex flex-[1_1_420px] flex-col gap-5">
        <h2
          id="pricing-title"
          className="font-display lg:text-display m-0 text-balance text-[32px] font-bold leading-[1.08] tracking-[-0.03em] sm:text-[40px]"
        >
          {t('title')}
        </h2>
        <p className="text-ink-2 m-0 max-w-[460px] text-pretty">{t('subtitle')}</p>
        <fieldset className="m-0 flex flex-col gap-2.5 border-0 p-0">
          <legend className="mb-2.5 p-0 text-sm font-semibold">{t('question')}</legend>
          <div className="flex flex-wrap gap-2">
            {COUNTS.map((n) => (
              <label key={n} className="relative">
                <input
                  type="radio"
                  name={name}
                  value={n}
                  checked={students === n}
                  onChange={() => setStudents(n)}
                  className="peer sr-only"
                />
                <span
                  className={cn(
                    'tabular flex h-11 min-w-[88px] cursor-pointer items-center justify-center rounded-full border px-[18px] font-semibold transition-colors',
                    'peer-focus-visible:outline-brand peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2',
                    students === n
                      ? 'border-ink bg-ink text-white'
                      : 'border-brand-line bg-surface text-ink hover:border-ink',
                  )}
                >
                  {num.format(n)}
                </span>
              </label>
            ))}
          </div>
        </fieldset>
        <p className="text-muted m-0 text-[13px] leading-5">
          {t('assumption', {
            classes: CARD_PRICING_DEFAULTS.classesPerStudent,
            perCard: formatLKR(CARD_PRICING_DEFAULTS.perCard),
          })}{' '}
          <Link href={ROUTES.pricing} className="font-medium">
            {t('seeFull')}
          </Link>
        </p>
      </div>

      <div
        className="bg-surface shadow-card tabular rounded-card flex max-w-[480px] flex-[1_1_400px] flex-col gap-5 p-6 sm:p-7"
        aria-live="polite"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="bg-ink rounded-xs flex h-[26px] items-center px-2.5 text-[13px] font-semibold text-white">
            {t(`plans.${plan.id}`)}
          </span>
          <span className="text-muted text-[13px]">
            {t('formula', {
              base: formatLKR(plan.base),
              students: num.format(quote.students),
              perStudent: formatLKR(plan.perStudent),
            })}
          </span>
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-muted text-sm">{t('perMonth')}</span>
          <span className="font-display text-[40px] font-bold leading-[48px] tracking-[-0.02em] sm:text-[44px]">
            {formatLKR(quote.total)}
          </span>
        </div>
        <div className="border-line flex items-baseline justify-between gap-4 border-y py-3.5">
          <span className="text-muted">{t('cardPricing')}</span>
          <s className="text-muted whitespace-nowrap font-medium">{formatLKR(cardTotal)}</s>
        </div>
        {savings > 0 && (
          <div className="bg-success-soft text-success-ink flex items-center justify-between gap-4 rounded-md px-3.5 py-3 font-semibold">
            <span className="flex items-center gap-2">
              <TrendingDown size={18} aria-hidden />
              {t('save')}
            </span>
            <span className="whitespace-nowrap">{formatLKR(savings)}</span>
          </div>
        )}
        <Link href={ROUTES.trial} className={buttonClass({ className: 'w-full' })}>
          {t('cta')}
        </Link>
      </div>
    </>
  );
}
