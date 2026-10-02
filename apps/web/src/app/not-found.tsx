import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { StatusPage } from '@/components/status-page';

// Global 404: unknown hosts, hosts the API doesn't know, and direct requests to the internal
// prefixes. Says nothing about any institute.

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('errors.notFound');
  return { title: t('metaTitle'), robots: { index: false, follow: false } };
}

export default async function NotFound() {
  const t = await getTranslations('errors.notFound');
  return <StatusPage title={t('title')} body={t('body')} />;
}
