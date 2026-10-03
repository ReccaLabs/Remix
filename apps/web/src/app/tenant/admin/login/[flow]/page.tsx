import { tenantAccess } from '@remix/types/api';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { AuthCardPage } from '@/components/auth/auth-card-page';
import { CodeFlow } from '@/components/auth/code-flow';
import { IntlIsland } from '@/components/intl-island';
import { TenantUnavailable, unavailableMetadata } from '@/components/tenant/tenant-unavailable';
import { codeFlowPurpose, STAFF_CODE_FLOWS } from '@/lib/code-flows';
import { TENANT_PATHS } from '@/lib/paths';
import { getTenant } from '@/server/api';

/** Staff SMS-code flows: `/admin/login/forgot` (AUTH-02) and `/admin/login/unlock` (AUTH-09). */

type Params = { params: Promise<{ flow: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const tenant = await getTenant();
  if (tenantAccess(tenant.status).staff === 'none') return unavailableMetadata();
  const flow = codeFlowPurpose((await params).flow, STAFF_CODE_FLOWS);
  if (!flow) return {};
  const t = await getTranslations(`auth.code.${flow.key}`);
  return { title: t('metaTitle'), robots: { index: false, follow: false } };
}

export default async function StaffCodeFlowPage({ params }: Params) {
  const flow = codeFlowPurpose((await params).flow, STAFF_CODE_FLOWS);
  if (!flow) notFound();
  const tenant = await getTenant();
  if (tenantAccess(tenant.status).staff === 'none') return <TenantUnavailable name={tenant.name} />;
  const t = await getTranslations('auth');

  return (
    <AuthCardPage
      tenant={tenant}
      area={t('staff.area')}
      title={t(`code.${flow.key}.title`)}
      intro={t(`code.${flow.key}.intro`)}
      backHref={TENANT_PATHS.staffLogin}
      backLabel={t('code.backToLogin')}
    >
      <IntlIsland namespaces={['auth']}>
        <CodeFlow purpose={flow.purpose} who="staff" loginHref={TENANT_PATHS.staffLogin} />
      </IntlIsland>
    </AuthCardPage>
  );
}
