import { Controller, Header } from '@nestjs/common';
import { API } from '@remix/types/api';
import { Public } from '../../common/auth/auth.decorators';
import { requireContext } from '../../common/context/request-context';
import { AppException } from '../../common/errors/app-exception';
import { TenantAccess } from '../../common/tenant/tenant-access.guard';
import { Endpoint, type EndpointResult } from '../../common/validation/endpoint';
import { DbTenantResolver } from './db-tenant-resolver';

@Controller()
export class TenantController {
  constructor(private readonly tenants: DbTenantResolver) {}

  /**
   * TEN-01 — public facts about the institute that owns this host, for any status: the web app
   * decides what a suspended or cancelled tenant shows (TEN-06). Unknown host → 404 from the
   * tenant guard before this runs.
   */
  @Public()
  @TenantAccess('always')
  @Header('cache-control', 'no-store')
  @Endpoint(API.tenant)
  async tenant(): Promise<EndpointResult<typeof API.tenant>> {
    const { host } = requireContext();
    const tenant = host ? await this.tenants.resolvePublic(host) : null;
    if (!tenant) throw new AppException('TENANT_NOT_FOUND', 404, 'Institute not found');
    return tenant;
  }
}
