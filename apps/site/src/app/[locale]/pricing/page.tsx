import { PLANS, PUBLIC_PLAN_IDS } from '@remix/types';
import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { ActiveStudents } from '@/components/pricing/active-students';
import { AddonsTable } from '@/components/pricing/addons-table';
import { BillingProvider } from '@/components/pricing/billing';
import { CalculatorBand } from '@/components/pricing/calculator-band';
import { PlanCards } from '@/components/pricing/plan-cards';
import { PricingCta } from '@/components/pricing/pricing-cta';
import { faqValues, PRICING_FAQ, PricingFaq } from '@/components/pricing/pricing-faq';
import { PricingHero } from '@/components/pricing/pricing-hero';
import { toLocale } from '@/i18n/routing';
import { jsonLd, pageMetadata } from '@/lib/seo';
import { ROUTES, SITE } from '@/lib/site';

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const locale = toLocale((await params).locale);
  const t = await getTranslations({ locale, namespace: 'pricing.meta' });
  return pageMetadata({
    locale,
    path: ROUTES.pricing,
    title: t('title'),
    description: t('description'),
  });
}

// design/claude-design/Pricing.dc.html
export default async function PricingPage({ params }: Props) {
  const locale = toLocale((await params).locale);
  setRequestLocale(locale);
  const plans = await getTranslations('pricing.plans');
  const faq = await getTranslations('pricing.faq');
  const url = `${SITE.url}/${locale}${ROUTES.pricing}/`;

  const structuredData = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'Product',
        name: SITE.name,
        url,
        brand: { '@type': 'Brand', name: SITE.name },
        offers: PUBLIC_PLAN_IDS.map((id) => ({
          '@type': 'Offer',
          name: plans(`${id}.name`),
          price: PLANS[id].base / 100,
          priceCurrency: 'LKR',
          url,
          priceSpecification: [
            {
              '@type': 'UnitPriceSpecification',
              price: PLANS[id].base / 100,
              priceCurrency: 'LKR',
              unitCode: 'MON',
            },
            {
              '@type': 'UnitPriceSpecification',
              price: PLANS[id].perStudent / 100,
              priceCurrency: 'LKR',
              unitText: 'active student per month',
            },
          ],
        })),
      },
      {
        '@type': 'FAQPage',
        mainEntity: PRICING_FAQ.map((k) => ({
          '@type': 'Question',
          name: faq(`items.${k}.q`),
          acceptedAnswer: { '@type': 'Answer', text: faq(`items.${k}.a`, faqValues) },
        })),
      },
    ],
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLd(structuredData) }}
      />
      <BillingProvider>
        <PricingHero />
        <PlanCards />
      </BillingProvider>
      <CalculatorBand />
      <ActiveStudents />
      <AddonsTable />
      <PricingFaq />
      <PricingCta />
    </>
  );
}
