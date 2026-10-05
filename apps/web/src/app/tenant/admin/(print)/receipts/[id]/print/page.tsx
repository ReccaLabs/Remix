import { can } from '@remix/types';
import { ApiError, idParamsSchema, tenantAccess } from '@remix/types/api';
import { buttonClass, EmptyState } from '@remix/ui';
import { CircleAlert } from 'lucide-react';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { IntlIsland } from '@/components/intl-island';
import { ReceiptPrint } from '@/components/receipts/receipt-print';
import { ReprintButton } from '@/components/receipts/reprint-button';
import styles from '@/components/receipts/receipt-print.module.css';
import { TenantUnavailable } from '@/components/tenant/tenant-unavailable';
import { ADMIN_PATHS, TENANT_PATHS } from '@/lib/paths';
import { getApi, getTenant, requireStaff } from '@/server/api';

export const generateMetadata = async () => ({
  title: (await getTranslations('settings.receiptPrint'))('meta'),
  robots: { index: false, follow: false },
});
/** Standalone route group keeps the admin shell off paper; the API still enforces fees.read. */
export default async function PrintReceiptPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireStaff();
  if (!can(session.user.roles, 'fees.read')) notFound();
  const tenant = await getTenant();
  if (tenantAccess(tenant.status).staff !== 'full') return <TenantUnavailable name={tenant.name} />;
  const parsed = idParamsSchema.safeParse(await params);
  if (!parsed.success) notFound();
  const t = await getTranslations('settings.receiptPrint');
  let receipt;
  try {
    receipt = await (await getApi()).call('getReceipt', { params: parsed.data });
  } catch (err) {
    if (err instanceof ApiError && (err.status === 404 || err.status === 403 || err.status === 400))
      notFound();
    if (err instanceof ApiError && err.status === 401) redirect(TENANT_PATHS.staffLogin);
    return (
      <main id="main" className="mx-auto max-w-xl p-4">
        <EmptyState
          icon={<CircleAlert />}
          title={t('loadError')}
          description={t('loadErrorHint')}
          action={
            <a
              className={buttonClass({ variant: 'secondary' })}
              href={`/admin/receipts/${parsed.data.id}/print`}
            >
              {t('retry')}
            </a>
          }
        />
      </main>
    );
  }
  return (
    <main id="main">
      <IntlIsland namespaces={['settings']}>
        <div className={styles.controls}>
          <ReprintButton />
          <Link href={ADMIN_PATHS.fees} className={buttonClass({ variant: 'secondary' })}>
            {t('back')}
          </Link>
        </div>
        <ReceiptPrint receipt={receipt} />
      </IntlIsland>
    </main>
  );
}
