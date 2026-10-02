import { tenantAccess } from '@remix/types/api';
import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { TenantUnavailable, unavailableMetadata } from '@/components/tenant/tenant-unavailable';
import { getTenant } from '@/server/api';

/** The institute's public website. Hidden behind a neutral page unless the institute is live. */

export async function generateMetadata(): Promise<Metadata> {
  const tenant = await getTenant();
  if (tenantAccess(tenant.status).publicSite) return {};
  return unavailableMetadata();
}

export default async function SiteLayout({ children }: { children: ReactNode }) {
  const tenant = await getTenant();
  if (!tenantAccess(tenant.status).publicSite) return <TenantUnavailable name={tenant.name} />;
  return children;
}
