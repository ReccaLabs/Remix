import { CheckoutReturnPage } from '@/components/fees/checkout-return-page';
import { portalMetadata } from '@/server/metadata';

export const generateMetadata = () => portalMetadata('pay');

/** FEE-04: PayHere `cancel_url`. The order status still comes from the API, not the redirect. */
export default CheckoutReturnPage;
