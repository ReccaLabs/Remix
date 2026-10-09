import 'server-only';
import { tenantAccess, type Theme } from '@remix/types/api';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { redirect } from 'next/navigation';
import { unavailableMetadata } from '@/components/tenant/tenant-unavailable';
import { TENANT_PATHS } from '@/lib/paths';
import { getApi, getTenant, problemCode } from './api';
import { getRequestContext } from './request';

/** Loaders and page titles of Settings → General, Theme and Halls. */

export type Loaded<T> = { ok: true; data: T } | { ok: false };

async function failed(what: string, err: unknown): Promise<{ ok: false }> {
  const code = problemCode(err);
  if (code === 'UNAUTHENTICATED') redirect(TENANT_PATHS.staffLogin);
  const { requestId } = await getRequestContext();
  console.error(`${what} failed`, { code: code ?? 'NO_PROBLEM_RESPONSE', requestId });
  return { ok: false };
}

export async function loadGeneral() {
  try {
    return { ok: true, data: await (await getApi()).call('getGeneralSettings') } as const;
  } catch (err) {
    return failed('GET /admin/settings/general', err);
  }
}

export async function loadTheme(): Promise<Loaded<Theme>> {
  try {
    return { ok: true, data: await (await getApi()).call('getTheme') };
  } catch (err) {
    return failed('GET /admin/settings/theme', err);
  }
}
export async function loadPayhere() {
  try {
    return { ok: true, data: await (await getApi()).call('getPayhereSettings') } as const;
  } catch (err) {
    return failed('GET /admin/settings/payhere', err);
  }
}
export async function loadFees() {
  try {
    return { ok: true, data: await (await getApi()).call('getFeeSettings') } as const;
  } catch (err) {
    return failed('GET /admin/settings/fees', err);
  }
}

export async function loadSmsWallet() {
  try {
    return { ok: true, data: await (await getApi()).call('smsWallet') } as const;
  } catch (err) {
    return failed('GET /admin/sms/wallet', err);
  }
}

const NO_INDEX = { robots: { index: false, follow: false } } as const;

export async function settingsMetadata(
  page: 'general' | 'theme' | 'halls' | 'payments' | 'fees' | 'sms',
): Promise<Metadata> {
  const tenant = await getTenant();
  if (tenantAccess(tenant.status).staff !== 'full') return unavailableMetadata();
  const t = await getTranslations('settings.meta');
  return { title: t(page), ...NO_INDEX };
}
