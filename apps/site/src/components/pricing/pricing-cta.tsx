import { buttonClass, DisplayHeading } from '@remix/ui';
import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { ROUTES } from '@/lib/site';

export async function PricingCta() {
  const t = await getTranslations('pricing.finalCta');
  const tc = await getTranslations('common.cta');

  return (
    <section aria-labelledby="pricing-cta-title" className="px-4 pb-16 sm:px-6 sm:pb-24">
      <div className="border-line-warm bg-surface max-w-marketing rounded-band mx-auto flex flex-wrap items-center justify-between gap-8 border px-6 py-12 sm:px-14 sm:py-16">
        <DisplayHeading
          id="pricing-cta-title"
          size="lg"
          className="max-w-[620px] lg:text-[44px] lg:leading-[1.05]"
        >
          {t('title')}
        </DisplayHeading>
        <div className="flex flex-wrap gap-3">
          <Link href={ROUTES.trial} className={buttonClass({ size: 'xl' })}>
            {tc('startTrial')}
          </Link>
          <Link href={ROUTES.demo} className={buttonClass({ variant: 'outline', size: 'xl' })}>
            {tc('bookDemo')}
          </Link>
        </div>
      </div>
    </section>
  );
}
