import { tenantAccess } from '@remix/types/api';
import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { StudentLoginForm } from '@/components/auth/student-login-form';
import { IntlIsland } from '@/components/intl-island';
import { PoweredBy } from '@/components/powered-by';
import { TenantTile } from '@/components/tenant/tenant-tile';
import { TenantUnavailable, unavailableMetadata } from '@/components/tenant/tenant-unavailable';
import { PORTAL_PATHS, TENANT_PATHS } from '@/lib/paths';
import { NEXT_PARAM, safeNextPath } from '@/lib/safe-next';
import { getSession, getTenant } from '@/server/api';

/** AUTH-01 — student login on the institute's own host (Student Login 1a phone, 1d desktop). */

export async function generateMetadata(): Promise<Metadata> {
  const tenant = await getTenant();
  if (!tenantAccess(tenant.status).studentPortal) return unavailableMetadata();
  const t = await getTranslations('auth.student');
  return { title: t('metaTitle') };
}

export default async function StudentLoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const tenant = await getTenant();
  if (!tenantAccess(tenant.status).studentPortal) return <TenantUnavailable name={tenant.name} />;

  // Already signed in here → straight to the portal. If the check itself fails (API hiccup),
  // still offer the form rather than an error page.
  const session = await getSession().catch(() => null);
  if (session?.user.kind === 'student' && session.user.tenantId === tenant.id) {
    redirect(PORTAL_PATHS.home);
  }

  const params = await searchParams;
  const redirectTo = safeNextPath(params[NEXT_PARAM], PORTAL_PATHS.home) ?? PORTAL_PATHS.home;
  const t = await getTranslations('auth.student');

  return (
    <main id="main" className="bg-surface min-h-dvh lg:grid lg:grid-cols-2">
      {/* Desktop: institute panel in the brand colour. */}
      <div className="bg-brand hidden flex-col justify-between gap-8 px-14 py-12 text-white lg:flex">
        <div className="flex items-center gap-3">
          <TenantTile tenant={tenant} inverse />
          <span className="text-lg font-semibold">{tenant.name}</span>
        </div>
        <p className="m-0 max-w-md text-[28px] font-semibold leading-[34px] tracking-[-0.02em]">
          {t('tagline')}
        </p>
      </div>

      <div className="flex min-h-dvh flex-col px-6 pb-7 pt-10 lg:px-14 lg:py-12">
        <div className="mx-auto flex w-full max-w-[400px] flex-1 flex-col gap-7 lg:justify-center">
          <div className="flex flex-col gap-3.5">
            <TenantTile tenant={tenant} size="lg" className="lg:hidden" />
            <h1 className="m-0 flex flex-col gap-0.5">
              <span className="text-[26px] font-semibold leading-8 tracking-[-0.02em] lg:hidden">
                {tenant.name}
              </span>
              <span className="text-muted lg:text-ink text-[15px] font-normal leading-[22px] lg:text-[28px] lg:font-semibold lg:leading-[34px] lg:tracking-[-0.02em]">
                {t('title')}
              </span>
            </h1>
            <p className="text-muted m-0 hidden lg:block">{t('subtitle')}</p>
          </div>

          <IntlIsland namespaces={['auth']}>
            <StudentLoginForm redirectTo={redirectTo} />
          </IntlIsland>

          <div className="text-muted flex flex-col gap-2 text-center text-sm">
            <p className="m-0">
              {t.rich('forgot', {
                link: (chunks) => (
                  <Link href={TENANT_PATHS.studentForgot} className="font-medium">
                    {chunks}
                  </Link>
                ),
              })}
            </p>
            <p className="m-0">
              {t.rich('firstTime', {
                link: (chunks) => (
                  <Link href={TENANT_PATHS.studentFirst} className="font-medium">
                    {chunks}
                  </Link>
                ),
              })}
            </p>
            <p className="m-0">
              {t.rich('staffLink', {
                link: (chunks) => (
                  <Link href={TENANT_PATHS.staffLogin} className="font-medium">
                    {chunks}
                  </Link>
                ),
              })}
            </p>
          </div>
        </div>
        <PoweredBy className="pt-8 text-center" />
      </div>
    </main>
  );
}
