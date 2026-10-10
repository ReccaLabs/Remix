import { getTranslations } from 'next-intl/server';
import { IntlIsland } from '@/components/intl-island';
import { PageBody, PageTitle } from '@/components/shell/page-body';
import { checkoutParam } from '@/lib/checkout-param';
import { requireStudent } from '@/server/api';
import { CheckoutResult } from './checkout-result';

/**
 * FEE-04: PayHere sends the student back to `/app/pay/return` or `/app/pay/cancel`. Neither
 * redirect proves anything; the island polls the order status the API learned from PayHere's
 * verified notification.
 */
export async function CheckoutReturnPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireStudent();
  const t = await getTranslations('fees');
  const checkoutId = checkoutParam((await searchParams).checkout);
  return (
    <PageBody>
      <PageTitle title={t('payTitle')} subtitle={t('checkout.title')} />
      <IntlIsland namespaces={['fees']}>
        <CheckoutResult checkoutId={checkoutId} />
      </IntlIsland>
    </PageBody>
  );
}
