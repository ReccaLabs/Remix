import { Global, Module, Optional, type OnModuleInit } from '@nestjs/common';
import { AuthNotifications } from '../auth/auth-notifications';
import { PeopleHooks } from './people-hooks';
import { StaffController } from './staff.controller';
import { StaffService } from './staff.service';
import { StudentsController } from './students.controller';
import { StudentsService } from './students.service';

/**
 * Admin students and staff (STU-01/02/03/05/07, PAR-01/03, STF-01/02/03). Global only for
 * {@link PeopleHooks}; `onModuleInit` connects them to the auth module's SMS delivery.
 */
@Global()
@Module({
  controllers: [StudentsController, StaffController],
  providers: [StudentsService, StaffService, PeopleHooks],
  exports: [PeopleHooks],
})
export class PeopleModule implements OnModuleInit {
  constructor(
    private readonly hooks: PeopleHooks,
    @Optional() private readonly notifications?: AuthNotifications,
  ) {}

  /** Connect the hooks to the auth module's SMS delivery (AUTH-07, `sms` queue only). */
  onModuleInit(): void {
    const notifications = this.notifications;
    if (!notifications) return;
    this.hooks.registerStudentInvited(async (event) => {
      await notifications.onStudentInvited(event.tenantId, event.studentId);
    });
    this.hooks.registerStaffInvited(async (event) => {
      await notifications.onStaffInvited(event.tenantId, {
        id: event.inviteId,
        phone: event.phone,
        token: event.token,
      });
    });
  }
}
