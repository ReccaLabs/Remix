'use client';

import { cn } from '@remix/ui';
import {
  baseForCycle,
  formatLKR,
  PLANS,
  YEARLY_BILLING,
  YEARLY_FREE_MONTHS,
  type BillingCycle,
  type PublicPlanId,
} from '@remix/types';
import { useTranslations } from 'next-intl';
import { createContext, useContext, useId, useState, type ReactNode } from 'react';

const BillingContext = createContext<{
  cycle: BillingCycle;
  setCycle: (cycle: BillingCycle) => void;
}>({ cycle: 'monthly', setCycle: () => {} });

/**
 * Holds the Monthly/Yearly choice. The hero and plan cards stay Server Components passed in as
 * children; only the toggle and the price blocks read this context on the client.
 */
export function BillingProvider({ children }: { children: ReactNode }) {
  const [cycle, setCycle] = useState<BillingCycle>('monthly');
  return <BillingContext value={{ cycle, setCycle }}>{children}</BillingContext>;
}

const CYCLES = ['monthly', 'yearly'] as const;

/** Segmented Monthly/Yearly control built from native radios (arrow keys work for free). */
export function BillingToggle({ className }: { className?: string }) {
  const t = useTranslations('pricing.billing');
  const { cycle, setCycle } = useContext(BillingContext);
  const name = useId();

  return (
    <fieldset className={cn('m-0 min-w-0 border-0 p-0', className)}>
      <legend className="sr-only">{t('legend')}</legend>
      <div className="bg-paper-2 border-line-warm flex items-center gap-1 rounded-[12px] border p-1">
        {CYCLES.map((c) => (
          <label key={c} className="relative">
            <input
              type="radio"
              name={name}
              value={c}
              checked={cycle === c}
              onChange={() => setCycle(c)}
              className="peer sr-only"
            />
            <span
              className={cn(
                'flex h-11 cursor-pointer items-center gap-2 rounded-sm px-5 font-semibold transition-colors sm:h-10',
                'peer-focus-visible:outline-brand peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2',
                c === 'yearly' && 'pr-3.5',
                cycle === c ? 'bg-surface text-ink shadow-seg' : 'text-muted hover:text-ink',
              )}
            >
              {t(c)}
              {c === 'yearly' && (
                <span className="bg-accent-soft text-accent-ink rounded-xs flex h-[22px] items-center px-2 text-xs">
                  {t('yearlyBadge', { months: YEARLY_FREE_MONTHS })}
                </span>
              )}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/** Base price, per-student fee and billing note for one plan card. */
export function PlanPrice({ plan, dark = false }: { plan: PublicPlanId; dark?: boolean }) {
  const t = useTranslations('pricing.billing');
  const { cycle } = useContext(BillingContext);
  const p = PLANS[plan];
  const muted = dark ? 'text-night-muted' : 'text-muted';

  return (
    <div className="tabular flex flex-col gap-1">
      <div className="flex flex-wrap items-baseline gap-x-1.5">
        <span className="font-display text-[36px] font-bold leading-[44px] tracking-[-0.02em] xl:text-[40px]">
          {formatLKR(baseForCycle(p, cycle))}
        </span>
        <span className={muted}>{t('perMonth')}</span>
      </div>
      <span className="font-medium">{t('perStudent', { price: formatLKR(p.perStudent) })}</span>
      <span className={cn('text-[13px] leading-5', muted)}>
        {cycle === 'yearly'
          ? t('noteYearly', {
              paid: YEARLY_BILLING.paidMonths,
              covered: YEARLY_BILLING.monthsCovered,
            })
          : t('noteMonthly')}
      </span>
    </div>
  );
}
