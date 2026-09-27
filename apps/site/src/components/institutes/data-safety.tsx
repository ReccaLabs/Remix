import { CARD_PRICING_DEFAULTS, compare, formatLKR, PLANS } from '@remix/types';
import { Container, DisplayHeading } from '@remix/ui';
import { ArrowRight, CheckCircle2 } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { ROUTES } from '@/lib/site';
import { PlanExample } from '../audience/plan-example';

const ITEMS = ['separate', 'support', 'audit', 'backups'] as const;

/** Example institute size for the price card. Amounts are computed, never written down. */
const EXAMPLE_STUDENTS = 800;

export async function DataSafety() {
  const t = await getTranslations('institutes.data');
  const tp = await getTranslations('institutes.plan');
  const { quote, cardTotal } = compare(EXAMPLE_STUDENTS);
  const { plan } = quote;

  return (
    <section aria-labelledby="data-title">
      <Container className="flex flex-wrap items-center gap-12 py-16 sm:py-24">
        <div className="flex min-w-0 flex-[1_1_440px] flex-col gap-5">
          <DisplayHeading id="data-title">{t('title')}</DisplayHeading>
          <ul className="m-0 flex list-none flex-col gap-4 p-0">
            {ITEMS.map((key) => (
              <li key={key} className="flex gap-3">
                <CheckCircle2 size={20} aria-hidden className="text-success mt-0.5 flex-none" />
                <span className="text-pretty">
                  <b className="font-semibold">{t(`items.${key}.title`)}</b>{' '}
                  <span className="text-ink-2">{t(`items.${key}.body`)}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>

        <PlanExample
          className="w-full flex-[0_1_460px]"
          label={tp('label', { students: quote.students })}
          badge={tp('badge')}
          example={tp('example', { students: quote.students })}
          price={formatLKR(quote.total)}
          perMonth={tp('perMonth')}
          rows={[
            { label: tp('base'), value: formatLKR(plan.base) },
            {
              label: tp('perStudent', {
                students: quote.students,
                perStudent: formatLKR(plan.perStudent),
              }),
              value: formatLKR(plan.perStudent * quote.students),
            },
          ]}
          anchor={{ label: tp('cardModel'), value: formatLKR(cardTotal) }}
          footer={
            <div className="flex flex-col gap-1">
              <p className="text-muted m-0 text-[13px] leading-5">
                {tp('assumption', {
                  classes: CARD_PRICING_DEFAULTS.classesPerStudent,
                  perCard: formatLKR(CARD_PRICING_DEFAULTS.perCard),
                })}
              </p>
              <Link
                href={`${ROUTES.pricing}#enterprise`}
                className="inline-flex min-h-11 items-center gap-1.5 self-start text-sm font-medium"
              >
                {tp('enterprise', { max: PLANS.institute.maxStudents })}
                <ArrowRight size={14} aria-hidden />
              </Link>
            </div>
          }
        />
      </Container>
    </section>
  );
}
