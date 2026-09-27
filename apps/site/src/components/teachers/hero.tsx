import { CARD_PRICING_DEFAULTS, compare, formatLKR, PLANS } from '@remix/types';
import { buttonClass, Container, DisplayHeading, Eyebrow } from '@remix/ui';
import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { ROUTES } from '@/lib/site';
import { PlanExample } from '../audience/plan-example';

/** Example class size for the price card. Amounts are computed, never written down. */
const EXAMPLE_STUDENTS = 120;

export async function TeachersHero() {
  const t = await getTranslations('teachers.hero');
  const tp = await getTranslations('teachers.plan');
  const tc = await getTranslations('common.cta');
  const { quote, cardTotal } = compare(EXAMPLE_STUDENTS);
  const { plan } = quote;

  return (
    <section aria-labelledby="teachers-title">
      <Container className="flex flex-wrap items-center gap-12 pb-16 pt-12 sm:pb-[88px] sm:pt-[72px] lg:gap-14">
        <div className="flex min-w-0 flex-[1_1_480px] flex-col gap-6">
          <Eyebrow>{t('eyebrow')}</Eyebrow>
          <DisplayHeading as="h1" id="teachers-title" size="xl" className="lg:text-[64px]">
            {t('title')}
          </DisplayHeading>
          <p className="text-ink-2 m-0 max-w-[520px] text-pretty text-lg leading-7">
            {t('subtitle', { max: PLANS.tutor.maxStudents })}
          </p>
          <div className="flex flex-wrap gap-3">
            <Link href={ROUTES.trial} className={buttonClass()}>
              {tc('startTrial')}
            </Link>
            <Link href={ROUTES.pricing} className={buttonClass({ variant: 'outline' })}>
              {t('seePricing')}
            </Link>
          </div>
        </div>

        <PlanExample
          className="w-full flex-[0_1_440px]"
          label={tp('label', { students: quote.students })}
          badge={tp('badge')}
          example={tp('example', { students: quote.students })}
          lead={tp('youPay')}
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
            <p className="text-muted m-0 text-[13px] leading-5">
              {tp('assumption', {
                classes: CARD_PRICING_DEFAULTS.classesPerStudent,
                perCard: formatLKR(CARD_PRICING_DEFAULTS.perCard),
              })}
            </p>
          }
        />
      </Container>
    </section>
  );
}
