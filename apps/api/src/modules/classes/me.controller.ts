import { Controller, Header } from '@nestjs/common';
import { API } from '@remix/types/api';
import { CurrentSession, CurrentTenant, SessionKinds } from '../../common/auth/auth.decorators';
import type { AuthSession } from '../../common/auth/session-authenticator';
import type { ResolvedTenant } from '../../common/tenant/tenant-resolver';
import { Endpoint, type EndpointResult } from '../../common/validation/endpoint';
import { MyClassesService } from './my-classes.service';

@Controller()
export class MeController {
  constructor(private readonly myClasses: MyClassesService) {}

  /** The signed-in student's classes this month. Students only: staff get 403 FORBIDDEN. */
  @SessionKinds('student')
  @Header('cache-control', 'no-store')
  @Endpoint(API.myClasses)
  async classes(
    @CurrentSession() session: AuthSession,
    @CurrentTenant() tenant: ResolvedTenant,
  ): Promise<EndpointResult<typeof API.myClasses>> {
    return { items: await this.myClasses.list(tenant.id, session.userId) };
  }
}
