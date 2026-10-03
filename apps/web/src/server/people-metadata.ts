import 'server-only';
import { tenantAccess } from '@remix/types/api';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { unavailableMetadata } from '@/components/tenant/tenant-unavailable';
import { getTenant } from './api';

/** `<title>` of the people pages — same TEN-06 handling as `adminMetadata`. */

const NO_INDEX = { robots: { index: false, follow: false } } as const;

export async function studentsMetadata(
  page: 'list' | 'new' | 'profile' | 'edit',
): Promise<Metadata> {
  const tenant = await getTenant();
  if (tenantAccess(tenant.status).staff !== 'full') return unavailableMetadata();
  const t = await getTranslations('students.meta');
  return { title: t(page), ...NO_INDEX };
}

export async function staffMetadata(): Promise<Metadata> {
  const tenant = await getTenant();
  if (tenantAccess(tenant.status).staff !== 'full') return unavailableMetadata();
  const t = await getTranslations('staff.meta');
  return { title: t('title'), ...NO_INDEX };
}

export async function importMetadata(): Promise<Metadata> {
  const tenant = await getTenant();
  if (tenantAccess(tenant.status).staff !== 'full') return unavailableMetadata();
  const t = await getTranslations('import.meta');
  return { title: t('title'), ...NO_INDEX };
}
