import { Container, Eyebrow } from '@remix/ui';
import { getTranslations } from 'next-intl/server';
import { BillingToggle } from './billing';

export async function PricingHero() {
  const t = await getTranslations('pricing.hero');

  return (
    <Container className="flex flex-col items-center gap-5 pb-8 pt-14 text-center sm:pb-10 sm:pt-[72px]">
      <Eyebrow>{t('eyebrow')}</Eyebrow>
      <h1 className="font-display m-0 max-w-[820px] text-balance text-[40px] font-extrabold leading-[1.02] tracking-[-0.035em] sm:text-[54px] lg:text-[64px] lg:leading-none">
        {t('title')}
      </h1>
      <p className="text-ink-2 m-0 max-w-[600px] text-pretty text-lg leading-7">{t('subtitle')}</p>
      <BillingToggle className="mt-2" />
    </Container>
  );
}
