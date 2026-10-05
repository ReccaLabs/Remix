import { Body, Controller, Header } from '@nestjs/common';
import { API } from '@remix/types/api';
import {
  CurrentSession,
  CurrentTenant,
  RequirePermission,
} from '../../common/auth/auth.decorators';
import type { AuthSession } from '../../common/auth/session-authenticator';
import { requireContext } from '../../common/context/request-context';
import type { ResolvedTenant } from '../../common/tenant/tenant-resolver';
import { Endpoint, type EndpointBody } from '../../common/validation/endpoint';
import { PayhereSettingsService } from './payhere-settings.service';

@Controller()
@RequirePermission('fees.settings')
export class MoneySettingsController {
  constructor(private readonly payhere: PayhereSettingsService) {}
  @Header('cache-control', 'no-store')
  @Endpoint(API.getPayhereSettings)
  getPayhere(@CurrentTenant() t: ResolvedTenant) {
    return this.payhere.get(t.id);
  }
  @Header('cache-control', 'no-store')
  @Endpoint(API.updatePayhereSettings)
  updatePayhere(
    @CurrentTenant() t: ResolvedTenant,
    @CurrentSession() s: AuthSession,
    @Body() b: EndpointBody<typeof API.updatePayhereSettings>,
  ) {
    return this.payhere.update(t.id, s, b);
  }
  @Header('cache-control', 'no-store')
  @Endpoint(API.testPayhere)
  testPayhere(@CurrentTenant() t: ResolvedTenant, @CurrentSession() s: AuthSession) {
    const origin = requireContext().origin;
    if (!origin) throw new Error('Missing validated request origin');
    return this.payhere.test(t.id, s, origin);
  }
}
