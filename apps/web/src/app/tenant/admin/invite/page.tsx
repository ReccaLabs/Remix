import { tenantAccess } from '@remix/types/api';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { AuthCardPage } from '@/components/auth/auth-card-page';
import { InviteAcceptance } from '@/components/auth/invite-acceptance';
import { IntlIsland } from '@/components/intl-island';
import { TenantUnavailable, unavailableMetadata } from '@/components/tenant/tenant-unavailable';
import { ADMIN_PATHS } from '@/lib/paths';
import { getTenant } from '@/server/api';

/**
 * AUTH-07 — staff invitation acceptance (`/admin/invite#<token>`). The server never sees the
 * token: it is in the URL fragment, read by the client island and sent only in POST bodies.
 */

export async function generateMetadata(): Promise<Metadata> {
  const tenant = await getTenant();
  if (tenantAccess(tenant.status).staff === 'none') return unavailableMetadata();
  const t = await getTranslations('auth.invite');
  return { title: t('metaTitle'), robots: { index: false, follow: false } };
}

export default async function InvitePage() {
  const tenant = await getTenant();
  if (tenantAccess(tenant.status).staff === 'none') return <TenantUnavailable name={tenant.name} />;
  const t = await getTranslations('auth');
  return (
    <AuthCardPage tenant={tenant} area={t('staff.area')} title={t('invite.metaTitle')}>
      <IntlIsland namespaces={['auth']}>
        <InviteAcceptance redirectTo={ADMIN_PATHS.home} />
      </IntlIsland>
    </AuthCardPage>
  );
}
