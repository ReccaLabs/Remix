import { getTranslations } from 'next-intl/server';
import { StatusPage } from '@/components/status-page';

/**
 * TEN-06: shown instead of a suspended or cancelled institute's site/portal. Deliberately
 * neutral — the name only, no status, reason, contact details or branding.
 */
export async function TenantUnavailable({ name }: { name: string }) {
  const t = await getTranslations('errors.unavailable');
  return <StatusPage title={t('title', { name })} body={t('body')} />;
}
