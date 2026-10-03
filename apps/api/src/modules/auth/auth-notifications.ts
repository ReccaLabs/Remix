import { Injectable } from '@nestjs/common';
import { InviteService } from './invite.service';
import { OtpService } from './otp.service';

/**
 * The hooks the people module (P2-B) calls after it commits a new invited student or staff
 * invitation. Injectable anywhere (AuthModule is global). Both send through the `sms` queue
 * only; a queue or limiter outage is a 503, a recent code to the same phone a 429.
 *
 * ```ts
 * await authNotifications.onStudentInvited(tenantId, student.id);
 * await authNotifications.onStaffInvited(tenantId, { id: invite.id, phone, token });
 * ```
 */
@Injectable()
export class AuthNotifications {
  constructor(
    private readonly otp: OtpService,
    private readonly invites: InviteService,
  ) {}

  /** AUTH-07: text an `invited` student a `first_password` code. False if not deliverable. */
  onStudentInvited(tenantId: string, userId: string): Promise<boolean> {
    return this.otp.sendCodeToUser(tenantId, userId, 'first_password');
  }

  /** AUTH-07: text the invitation link (`/admin/invite#<token>`). False without a mobile. */
  onStaffInvited(
    tenantId: string,
    invite: { id: string; phone: string | null; token: string },
  ): Promise<boolean> {
    return this.invites.notifyStaffInvited(tenantId, invite);
  }
}
