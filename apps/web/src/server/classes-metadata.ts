import 'server-only';
import { tenantAccess } from '@remix/types/api';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { unavailableMetadata } from '@/components/tenant/tenant-unavailable';
import { getTenant } from './api';

/** `<title>` of the class pages — same TEN-06 handling as `adminMetadata`. */

const NO_INDEX = { robots: { index: false, follow: false } } as const;

export async function classesMetadata(
  page: 'list' | 'new' | 'detail' | 'edit' | 'timetable',
): Promise<Metadata> {
  const tenant = await getTenant();
  if (tenantAccess(tenant.status).staff !== 'full') return unavailableMetadata();
  const t = await getTranslations('classes.meta');
  return { title: t(page), ...NO_INDEX };
}
