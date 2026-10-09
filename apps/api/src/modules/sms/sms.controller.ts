import { Body, Controller, Header } from '@nestjs/common';
import { API } from '@remix/types/api';
import { CurrentSession, CurrentTenant, RequirePermission } from '../../common/auth/auth.decorators';
import type { AuthSession } from '../../common/auth/session-authenticator';
import { RateLimit } from '../../common/rate-limit/rate-limit.guard';
import type { ResolvedTenant } from '../../common/tenant/tenant-resolver';
import { Endpoint, type EndpointBody } from '../../common/validation/endpoint';
import { FeeRemindersService } from './fee-reminders.service';
import { SmsWalletService } from './sms-wallet.service';

/** MSG-02 wallet and FEE-02 manual reminders. Permissions: ADR 0008 / `permissions.ts`. */
@Controller()
export class SmsController {
  constructor(
    private readonly wallet: SmsWalletService,
    private readonly reminders: FeeRemindersService,
  ) {}

  @RequirePermission('sms.wallet')
  @Header('cache-control', 'no-store')
  @Endpoint(API.smsWallet)
  smsWallet(@CurrentTenant() t: ResolvedTenant) {
    return this.wallet.wallet(t.id);
  }

  @RequirePermission('sms.wallet')
  @RateLimit({ name: 'sms-top-up-request', limit: 5, windowSec: 15 * 60, by: 'user' })
  @Endpoint(API.requestSmsTopUp)
  async requestSmsTopUp(
    @CurrentTenant() t: ResolvedTenant,
    @CurrentSession() s: AuthSession,
    @Body() b: EndpointBody<typeof API.requestSmsTopUp>,
  ): Promise<undefined> {
    await this.wallet.requestTopUp(t.id, s, b.amountCents);
    return undefined;
  }

  @RequirePermission('sms.send')
  @RateLimit({ name: 'sms-reminder-preview', limit: 30, windowSec: 60, by: 'user' })
  @Header('cache-control', 'no-store')
  @Endpoint(API.previewReminders)
  previewReminders(
    @CurrentTenant() t: ResolvedTenant,
    @Body() b: EndpointBody<typeof API.previewReminders>,
  ) {
    return this.reminders.preview(t.id, b);
  }

  @RequirePermission('sms.send')
  @RateLimit({ name: 'sms-reminder-send', limit: 10, windowSec: 60, by: 'user' })
  @Header('cache-control', 'no-store')
  @Endpoint(API.sendReminders)
  sendReminders(
    @CurrentTenant() t: ResolvedTenant,
    @CurrentSession() s: AuthSession,
    @Body() b: EndpointBody<typeof API.sendReminders>,
  ) {
    return this.reminders.send(t.id, s, b);
  }
}
