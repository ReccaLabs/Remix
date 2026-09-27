import { PLANS } from '@remix/types';
import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { TeacherFeatures } from '@/components/teachers/features';
import { TeachersFinalCta } from '@/components/teachers/final-cta';
import { TeachersHero } from '@/components/teachers/hero';
import { Saturday } from '@/components/teachers/saturday';
import { SwitchSteps } from '@/components/teachers/switch-steps';
import { toLocale } from '@/i18n/routing';
import { pageMetadata } from '@/lib/seo';
import { ROUTES } from '@/lib/site';

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const locale = toLocale((await params).locale);
  const t = await getTranslations({ locale, namespace: 'teachers.meta' });
  return pageMetadata({
    locale,
    path: ROUTES.teachers,
    title: t('title'),
    description: t('description', { max: PLANS.tutor.maxStudents }),
  });
}

// design/claude-design/For Teachers.dc.html
export default async function ForTeachersPage({ params }: Props) {
  const locale = toLocale((await params).locale);
  setRequestLocale(locale);

  return (
    <>
      <TeachersHero />
      <Saturday />
      <TeacherFeatures />
      <SwitchSteps />
      <TeachersFinalCta />
    </>
  );
}
