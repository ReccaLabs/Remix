import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { LegalDocument } from '@/components/legal/legal-document';
import { toLocale } from '@/i18n/routing';
import { pageMetadata } from '@/lib/seo';
import { ROUTES } from '@/lib/site';

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const locale = toLocale((await params).locale);
  const t = await getTranslations({ locale, namespace: 'legal' });
  return pageMetadata({
    locale,
    path: ROUTES.dataProtection,
    title: t('dataProtection.meta.title'),
    description: t('dataProtection.meta.description'),
  });
}

// Plain long-form text page (no design file). Draft pending legal review.
export default async function DataProtectionPage({ params }: Props) {
  const locale = toLocale((await params).locale);
  setRequestLocale(locale);
  return <LegalDocument page="dataProtection" />;
}
