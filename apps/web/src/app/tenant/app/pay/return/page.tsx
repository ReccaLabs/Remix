import { CheckoutReturnPage } from '@/components/fees/checkout-return-page';
import { portalMetadata } from '@/server/metadata';

export const generateMetadata = () => portalMetadata('pay');

/** FEE-04: PayHere `return_url`. */
export default CheckoutReturnPage;
