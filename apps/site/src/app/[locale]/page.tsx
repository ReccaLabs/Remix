import { PLANS } from '@remix/types';
import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Faq } from '@/components/home/faq';
import { Features } from '@/components/home/features';
import { FinalCta } from '@/components/home/final-cta';
import { Hero } from '@/components/home/hero';
import { PricingBand } from '@/components/home/pricing-band';
import { Problems } from '@/components/home/problems';
import { ScreensTour } from '@/components/home/screens-tour';
import { JsonLd } from '@/components/seo/json-ld';
import { toLocale } from '@/i18n/routing';
import { pageMetadata } from '@/lib/seo';
import { SITE } from '@/lib/site';

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const locale = toLocale((await params).locale);
  const t = await getTranslations({ locale, namespace: 'home.meta' });
  return {
    ...pageMetadata({ locale, path: '/', title: t('title'), description: t('description') }),
    title: { absolute: t('title') },
  };
}

// design/claude-design/ReMix Home.dc.html
export default async function HomePage({ params }: Props) {
  const locale = toLocale((await params).locale);
  setRequestLocale(locale);
  const faq = await getTranslations('home.faq');

  const structuredData = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'Organization',
        '@id': `${SITE.url}/#org`,
        name: SITE.company,
        url: SITE.url,
        email: SITE.email.hello,
        address: {
          '@type': 'PostalAddress',
          addressLocality: SITE.city,
          addressCountry: SITE.country,
        },
        brand: { '@type': 'Brand', name: SITE.name },
      },
      {
        '@type': 'SoftwareApplication',
        name: SITE.name,
        applicationCategory: 'EducationalApplication',
        operatingSystem: 'Web, Android, iOS',
        publisher: { '@id': `${SITE.url}/#org` },
        offers: {
          '@type': 'AggregateOffer',
          priceCurrency: 'LKR',
          lowPrice: PLANS.tutor.base / 100,
          offerCount: 3,
        },
      },
      {
        '@type': 'FAQPage',
        mainEntity: (['safety', 'migration', 'payments', 'languages', 'offline'] as const).map(
          (k) => ({
            '@type': 'Question',
            name: faq(`items.${k}.q`),
            acceptedAnswer: { '@type': 'Answer', text: faq(`items.${k}.a`) },
          }),
        ),
      },
    ],
  };

  return (
    <>
      <JsonLd data={structuredData} />
      <Hero />
      <Problems />
      <Features />
      <PricingBand />
      <ScreensTour />
      <Faq />
      <FinalCta />
    </>
  );
}
