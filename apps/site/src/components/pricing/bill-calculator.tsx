'use client';

import { buttonClass } from '@remix/ui';
import {
  averagePerStudent,
  CALCULATOR_RANGE,
  CARD_PRICING_DEFAULTS,
  compare,
  formatLKR,
} from '@remix/types';
import { TrendingDown } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useId, useState } from 'react';
import { Link } from '@/i18n/navigation';
import { ROUTES } from '@/lib/site';

const num = new Intl.NumberFormat('en-US');

function Slider({
  label,
  value,
  valueText,
  range,
  onChange,
}: {
  label: string;
  value: number;
  valueText: string;
  range: { min: number; max: number; step: number };
  onChange: (value: number) => void;
}) {
  const id = useId();
  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex justify-between gap-4 font-semibold">
        <label htmlFor={id}>{label}</label>
        <output htmlFor={id} className="tabular">
          {num.format(value)}
        </output>
      </div>
      <input
        id={id}
        type="range"
        min={range.min}
        max={range.max}
        step={range.step}
        value={value}
        aria-valuetext={valueText}
        onChange={(e) => onChange(Number(e.target.value))}
        className="accent-brand h-6 w-full cursor-pointer"
      />
      <div aria-hidden className="text-muted tabular flex justify-between text-xs">
        <span>{num.format(range.min)}</span>
        <span>{num.format(range.max)}</span>
      </div>
    </div>
  );
}

/**
 * Pricing-page calculator: sliders for active students and classes per student, compared with
 * per-class-card pricing. Every number comes from @remix/types/pricing.
 */
export function BillCalculator() {
  const t = useTranslations('pricing.calculator');
  const tp = useTranslations('pricing.plans');
  const [students, setStudents] = useState<number>(CALCULATOR_RANGE.students.initial);
  const [classes, setClasses] = useState<number>(CALCULATOR_RANGE.classesPerStudent.initial);
  const { quote, cardTotal, savings } = compare(students, classes);
  const { plan } = quote;
  const planId = plan.id === 'lite' ? 'tutor' : plan.id;

  return (
    <>
      <div className="flex min-w-0 flex-[1_1_440px] flex-col gap-7">
        <div className="flex flex-col gap-3">
          <h2
            id="calculator-title"
            className="font-display m-0 text-balance text-[32px] font-bold leading-[1.08] tracking-[-0.03em] sm:text-[40px] lg:text-[44px] lg:leading-[1.05]"
          >
            {t('title')}
          </h2>
          <p className="text-ink-2 m-0 text-pretty">{t('subtitle')}</p>
        </div>
        <Slider
          label={t('students')}
          value={students}
          valueText={t('studentsValue', { count: num.format(students) })}
          range={CALCULATOR_RANGE.students}
          onChange={setStudents}
        />
        <Slider
          label={t('classes')}
          value={classes}
          valueText={t('classesValue', { count: num.format(classes) })}
          range={CALCULATOR_RANGE.classesPerStudent}
          onChange={setClasses}
        />
        <p className="text-muted m-0 text-[13px] leading-5">
          {t('assumption', {
            perCard: formatLKR(CARD_PRICING_DEFAULTS.perCard),
            minimum: formatLKR(CARD_PRICING_DEFAULTS.minimum),
          })}
        </p>
      </div>

      <div
        className="bg-surface shadow-card tabular rounded-card flex w-full min-w-0 max-w-[480px] flex-[1_1_400px] flex-col gap-5 p-6 sm:p-7"
        aria-live="polite"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="bg-ink rounded-xs flex h-[26px] items-center px-2.5 text-[13px] font-semibold text-white">
            {tp(`${planId}.name`)}
          </span>
          <span className="text-muted text-right text-[13px]">
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
          <span className="text-muted text-[13px] leading-5">
            {t('average', { price: formatLKR(averagePerStudent(quote)) })}
          </span>
        </div>
        <div className="border-line flex items-baseline justify-between gap-4 border-y py-3.5">
          <span className="text-muted">{t('cardPricing')}</span>
          <s className="text-muted font-medium">{formatLKR(cardTotal)}</s>
        </div>
        <div className="bg-success-soft text-success-ink flex items-center justify-between gap-4 rounded-md px-3.5 py-3 font-semibold">
          <span className="flex items-center gap-2">
            <TrendingDown size={18} aria-hidden />
            {t('save')}
          </span>
          <span>{formatLKR(Math.max(0, savings))}</span>
        </div>
        <Link href={ROUTES.trial} className={buttonClass({ className: 'w-full' })}>
          {t('cta')}
        </Link>
      </div>
    </>
  );
}
