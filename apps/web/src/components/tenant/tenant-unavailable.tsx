import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import { StatusPage } from '@/components/status-page';

/**
 * TEN-06: shown instead of a suspended or cancelled institute's site/portal. Deliberately
 * neutral — the name only, no status, reason, contact details or branding.
 */
export async function TenantUnavailable({
  name,
  children,
}: {
  name: string;
  /** Optional action, e.g. Log out for a signed-in person. */
  children?: ReactNode;
}) {
  const t = await getTranslations('errors.unavailable');
  return (
    <StatusPage title={t('title', { name })} body={t('body')}>
      {children}
    </StatusPage>
  );
}

/** `<head>` for the unavailable state: neutral title, kept out of search results. */
export async function unavailableMetadata(): Promise<Metadata> {
  const t = await getTranslations('errors.unavailable');
  return { title: t('metaTitle'), robots: { index: false, follow: false } };
}
