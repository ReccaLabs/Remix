import { buttonClass } from '@remix/ui';
import type { Metadata } from 'next';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { StatusPage } from '@/components/status-page';
import { PLATFORM_PATHS } from '@/lib/paths';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('errors.notFound');
  return { title: t('metaTitle') };
}

export default async function PlatformNotFound() {
  const t = await getTranslations('errors.notFound');
  return (
    <StatusPage title={t('title')} body={t('body')}>
      <Link href={PLATFORM_PATHS.home} className={buttonClass()}>
        {t('home')}
      </Link>
    </StatusPage>
  );
}
