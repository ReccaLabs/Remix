import { tenantAccess } from '@remix/types/api';
import { Info } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { StaffLoginForm } from '@/components/auth/staff-login-form';
import { IntlIsland } from '@/components/intl-island';
import { PoweredBy } from '@/components/powered-by';
import { TenantTile } from '@/components/tenant/tenant-tile';
import { TenantUnavailable, unavailableMetadata } from '@/components/tenant/tenant-unavailable';
import { ADMIN_PATHS, TENANT_PATHS } from '@/lib/paths';
import { NEXT_PARAM, safeNextPath } from '@/lib/safe-next';
import { getSession, getTenant } from '@/server/api';

/**
 * AUTH-05 — institute staff login (2-step code step: Staff Login 15b/15d, in the form) (Staff Login 15a desktop, 15c phone). Staff of a
 * suspended institute can still sign in (billing only, TEN-06); a cancelled one is unavailable.
 */

export async function generateMetadata(): Promise<Metadata> {
  const tenant = await getTenant();
  if (tenantAccess(tenant.status).staff === 'none') return unavailableMetadata();
  const t = await getTranslations('auth.staff');
  return { title: t('metaTitle'), robots: { index: false, follow: false } };
}

export default async function StaffLoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const tenant = await getTenant();
  if (tenantAccess(tenant.status).staff === 'none') return <TenantUnavailable name={tenant.name} />;

  const session = await getSession().catch(() => null);
  if (session?.user.kind === 'staff' && session.user.tenantId === tenant.id) {
    redirect(ADMIN_PATHS.home);
  }

  const params = await searchParams;
  const redirectTo = safeNextPath(params[NEXT_PARAM], ADMIN_PATHS.home) ?? ADMIN_PATHS.home;
  const t = await getTranslations('auth.staff');

  return (
    <main
      id="main"
      className="bg-surface md:bg-canvas flex min-h-dvh flex-col items-center px-6 pb-8 pt-10 text-sm leading-5 md:justify-center md:gap-6 md:px-4"
    >
      <div className="flex w-full max-w-[420px] flex-col gap-6 md:items-center">
        <div className="flex items-center gap-2.5">
          <TenantTile tenant={tenant} />
          <div className="flex flex-col">
            <span className="text-base font-semibold">{tenant.name}</span>
            <span className="text-muted text-xs">{t('area')}</span>
          </div>
        </div>

        <div className="md:bg-surface md:border-line md:rounded-card flex w-full flex-col gap-5 md:border md:p-7">
          <div className="flex flex-col gap-1">
            <h1 className="m-0 text-2xl font-semibold tracking-[-0.02em] md:text-[26px] md:leading-8">
              {t('title')}
            </h1>
            <p className="text-muted m-0">{t('subtitle')}</p>
          </div>

          <IntlIsland namespaces={['auth']}>
            <StaffLoginForm redirectTo={redirectTo} />
          </IntlIsland>

          <p className="text-muted m-0 text-[13px]">
            {t.rich('forgot', {
              link: (chunks) => (
                <Link href={TENANT_PATHS.staffForgot} className="font-medium">
                  {chunks}
                </Link>
              ),
            })}
          </p>
          <div className="bg-canvas text-ink-2 flex gap-2.5 rounded-md p-3 text-[13px]">
            <Info aria-hidden size={16} className="mt-0.5 flex-none" />
            <p className="m-0">
              {t.rich('studentsElsewhere', {
                link: (chunks) => (
                  <Link href={TENANT_PATHS.studentLogin} className="font-medium">
                    {chunks}
                  </Link>
                ),
              })}
            </p>
          </div>
        </div>
      </div>
      <PoweredBy className="mt-auto pt-8 md:mt-0 md:pt-0" />
    </main>
  );
}
