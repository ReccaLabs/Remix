import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { CounterRush } from '@/components/institutes/counter-rush';
import { DataSafety } from '@/components/institutes/data-safety';
import { DemoCta } from '@/components/institutes/demo-cta';
import { InstitutesHero } from '@/components/institutes/hero';
import { Roles } from '@/components/institutes/roles';
import { toLocale } from '@/i18n/routing';
import { pageMetadata } from '@/lib/seo';
import { ROUTES } from '@/lib/site';

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const locale = toLocale((await params).locale);
  const t = await getTranslations({ locale, namespace: 'institutes.meta' });
  return pageMetadata({
    locale,
    path: ROUTES.institutes,
    title: t('title'),
    description: t('description'),
  });
}

// design/claude-design/For Institutes.dc.html
export default async function ForInstitutesPage({ params }: Props) {
  const locale = toLocale((await params).locale);
  setRequestLocale(locale);

  return (
    <>
      <InstitutesHero />
      <Roles />
      <CounterRush />
      <DataSafety />
      <DemoCta />
    </>
  );
}
