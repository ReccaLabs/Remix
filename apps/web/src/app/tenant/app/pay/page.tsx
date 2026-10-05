import { getTranslations } from 'next-intl/server';
import type { MyFeesResponse } from '@remix/types/api';
import { IntlIsland } from '@/components/intl-island';
import { PayOverview } from '@/components/fees/pay-overview';
import { LoadError } from '@/components/portal/load-error';
import { PageBody, PageTitle } from '@/components/shell/page-body';
import { PORTAL_PATHS } from '@/lib/paths';
import { getApi, requireStudent } from '@/server/api';
import { portalMetadata } from '@/server/metadata';

export const generateMetadata = () => portalMetadata('pay');

export default async function PayPage() {
  await requireStudent();
  const t = await getTranslations('fees');
  let fees: MyFeesResponse | null = null;
  try { fees = await (await getApi()).call('myFees'); } catch { /* Keep navigation and retry available. */ }
  return <PageBody>
    <PageTitle title={t('payTitle')} subtitle={t('paySubtitle')} />
    {fees ? <IntlIsland namespaces={['fees']}><PayOverview fees={fees} /></IntlIsland> : <LoadError retryHref={PORTAL_PATHS.pay} />}
  </PageBody>;
}
