import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { getTenant } from '@/server/api';

/**
 * Every institute host: public site, student portal and institute admin. The tenant comes from
 * the proxy-classified host only (getTenant → GET /api/v1/tenant); a host the API doesn't know
 * 404s here, before any tenant page renders.
 */

export async function generateMetadata(): Promise<Metadata> {
  const tenant = await getTenant();
  return {
    title: { default: tenant.name, template: `%s · ${tenant.name}` },
    applicationName: tenant.name,
  };
}

export default async function TenantLayout({ children }: { children: ReactNode }) {
  await getTenant();
  return children;
}
