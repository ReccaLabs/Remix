import { Injectable, Logger } from '@nestjs/common';
import type { StaffRole } from '@remix/types/api';

export interface StudentInvitedEvent {
  tenantId: string;
  studentId: string;
  displayName: string;
  /** E.164. The welcome SMS tells the student to set a password with a `first_password` code. */
  phone: string;
}

export interface StaffInvitedEvent {
  tenantId: string;
  inviteId: string;
  /**
   * The raw invitation token (256-bit, base64url). It exists only here: the database keeps its
   * SHA-256. The delivery handler must put it in the link *fragment* (never a path or query,
   * AUTH-07) and must never log or persist it.
   */
  token: string;
  displayName: string;
  phone: string | null;
  email: string | null;
  role: StaffRole;
  expiresAt: Date;
}

type Handler<E> = (event: E) => Promise<void> | void;

/**
 * Seam between the people module and message delivery.
 *
 * PeopleModule registers handlers that call the auth module's `AuthNotifications` (welcome
 * `first_password` SMS and the staff invitation link, both through the `sms` queue, AUTH-07).
 *
 * The hooks run after the database transaction has committed. A failing handler is logged (without
 * the event, which carries the token) and never fails the request: the student / invite exists and
 * can be re-sent.
 */
@Injectable()
export class PeopleHooks {
  private readonly logger = new Logger('PeopleHooks');
  private readonly studentInvited: Handler<StudentInvitedEvent>[] = [];
  private readonly staffInvited: Handler<StaffInvitedEvent>[] = [];

  registerStudentInvited(handler: Handler<StudentInvitedEvent>): void {
    this.studentInvited.push(handler);
  }

  registerStaffInvited(handler: Handler<StaffInvitedEvent>): void {
    this.staffInvited.push(handler);
  }

  /** Called after a student was created with `sendWelcomeSms`. */
  async onStudentInvited(event: StudentInvitedEvent): Promise<void> {
    await this.run('onStudentInvited', this.studentInvited, event);
  }

  /** Called after a staff invitation was stored; carries the raw token. */
  async onStaffInvited(event: StaffInvitedEvent): Promise<void> {
    await this.run('onStaffInvited', this.staffInvited, event);
  }

  private async run<E>(name: string, handlers: Handler<E>[], event: E): Promise<void> {
    for (const handler of handlers) {
      try {
        await handler(event);
      } catch (error) {
        this.logger.error(
          `${name} handler failed: ${error instanceof Error ? error.name : 'unknown error'}`,
        );
      }
    }
  }
}
