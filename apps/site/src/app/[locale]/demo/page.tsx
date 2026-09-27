import { Container } from '@remix/ui';
import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Suspense } from 'react';
import { DemoIntro } from '@/components/demo/demo-intro';
import { LeadForm } from '@/components/demo/lead-form';
import { LeadFormFromUrl } from '@/components/demo/lead-form-from-url';
import { toLocale } from '@/i18n/routing';
import { pageMetadata } from '@/lib/seo';
import { ROUTES, whatsappUrl } from '@/lib/site';

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const locale = toLocale((await params).locale);
  const t = await getTranslations({ locale, namespace: 'demo.meta' });
  return pageMetadata({
    locale,
    path: ROUTES.demo,
    title: t('title'),
    description: t('description'),
  });
}

// Built from the brand (no dedicated design): layout follows the #demo band in For Institutes.dc.html.
// One page for "Book a demo" and "Start free trial" (ROUTES.trial = /demo?intent=trial).
export default async function DemoPage({ params }: Props) {
  const locale = toLocale((await params).locale);
  setRequestLocale(locale);
  const tc = await getTranslations('common.cta');
  const wa = whatsappUrl(tc('whatsappPrefill'));

  return (
    <Container className="grid items-start gap-10 py-12 sm:py-16 lg:grid-cols-[minmax(0,1fr)_minmax(0,560px)] lg:gap-16 lg:py-20">
      <DemoIntro whatsappHref={wa} />
      <div className="border-line-warm bg-surface shadow-card rounded-card border p-5 sm:p-8">
        <Suspense fallback={<LeadForm initialIntent="demo" whatsappHref={wa} />}>
          <LeadFormFromUrl whatsappHref={wa} />
        </Suspense>
      </div>
    </Container>
  );
}
