import { Global, Module } from '@nestjs/common';
import { CLOCK, type Clock } from '../../common/time/clock';
import { DbTenantResolver, TENANT_CACHE } from './db-tenant-resolver';
import { InMemoryTenantCache } from './tenant-cache';
import { TenantController } from './tenant.controller';

/**
 * TEN-01/02/06: host → tenant resolution and `GET /api/v1/tenant`. Global so the core module
 * can bind `TENANT_RESOLVER` to {@link DbTenantResolver}.
 */
@Global()
@Module({
  controllers: [TenantController],
  providers: [
    DbTenantResolver,
    {
      provide: TENANT_CACHE,
      inject: [CLOCK],
      useFactory: (clock: Clock) => new InMemoryTenantCache(() => clock.now().getTime()),
    },
  ],
  exports: [DbTenantResolver, TENANT_CACHE],
})
export class TenancyModule {}
