import 'server-only';
import { tenantAccess } from '@remix/types/api';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { unavailableMetadata } from '@/components/tenant/tenant-unavailable';
import { getTenant } from './api';

/**
 * `<title>` for portal and admin pages. A page's metadata overrides its layout's, so each page
 * repeats the TEN-06 check: an unavailable institute gets the neutral title, never the section.
 */

export async function portalMetadata(
  page: 'home' | 'classes' | 'pay' | 'live' | 'me',
): Promise<Metadata> {
  const tenant = await getTenant();
  if (!tenantAccess(tenant.status).studentPortal) return unavailableMetadata();
  const t = await getTranslations('portal.meta');
  return { title: t(page) };
}

export async function adminMetadata(
  page: 'dashboard' | 'students' | 'fees' | 'classes' | 'more',
): Promise<Metadata> {
  const tenant = await getTenant();
  if (tenantAccess(tenant.status).staff === 'none') return unavailableMetadata();
  if (tenantAccess(tenant.status).staff === 'billing-only') {
    const t = await getTranslations('admin.billingOnly');
    return { title: t('metaTitle') };
  }
  const t = await getTranslations('admin.meta');
  return { title: t(page) };
}
