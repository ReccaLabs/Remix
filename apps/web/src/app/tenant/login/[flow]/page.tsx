import { tenantAccess } from '@remix/types/api';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { AuthCardPage } from '@/components/auth/auth-card-page';
import { CodeFlow } from '@/components/auth/code-flow';
import { IntlIsland } from '@/components/intl-island';
import { TenantUnavailable, unavailableMetadata } from '@/components/tenant/tenant-unavailable';
import { codeFlowPurpose, STUDENT_CODE_FLOWS } from '@/lib/code-flows';
import { TENANT_PATHS } from '@/lib/paths';
import { getTenant } from '@/server/api';

/**
 * Student SMS-code flows (Student Login 1b): `/login/forgot` (AUTH-02), `/login/first` — set the
 * first password after the institute added you (AUTH-07) — and `/login/unlock` (AUTH-09).
 */

type Params = { params: Promise<{ flow: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const tenant = await getTenant();
  if (!tenantAccess(tenant.status).studentPortal) return unavailableMetadata();
  const flow = codeFlowPurpose((await params).flow, STUDENT_CODE_FLOWS);
  if (!flow) return {};
  const t = await getTranslations(`auth.code.${flow.key}`);
  return { title: t('metaTitle'), robots: { index: false, follow: false } };
}

export default async function StudentCodeFlowPage({ params }: Params) {
  const flow = codeFlowPurpose((await params).flow, STUDENT_CODE_FLOWS);
  if (!flow) notFound();
  const tenant = await getTenant();
  if (!tenantAccess(tenant.status).studentPortal) return <TenantUnavailable name={tenant.name} />;
  const t = await getTranslations('auth');

  return (
    <AuthCardPage
      tenant={tenant}
      title={t(`code.${flow.key}.title`)}
      intro={t(`code.${flow.key}.intro`)}
      backHref={TENANT_PATHS.studentLogin}
      backLabel={t('code.backToLogin')}
    >
      <IntlIsland namespaces={['auth']}>
        <CodeFlow purpose={flow.purpose} who="student" loginHref={TENANT_PATHS.studentLogin} />
      </IntlIsland>
    </AuthCardPage>
  );
}
