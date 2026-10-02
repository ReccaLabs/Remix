import { tenantAccess } from '@remix/types/api';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import { TenantUnavailable } from '@/components/tenant/tenant-unavailable';
import { getTenant } from '@/server/api';

/** The institute's public website. Hidden behind a neutral page unless the institute is live. */

export async function generateMetadata(): Promise<Metadata> {
  const tenant = await getTenant();
  if (tenantAccess(tenant.status).publicSite) return {};
  const t = await getTranslations('errors.unavailable');
  return { title: t('metaTitle'), robots: { index: false, follow: false } };
}

export default async function SiteLayout({ children }: { children: ReactNode }) {
  const tenant = await getTenant();
  if (!tenantAccess(tenant.status).publicSite) return <TenantUnavailable name={tenant.name} />;
  return children;
}
