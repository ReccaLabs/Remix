/**
 * A tenant's connected meeting account (Zoom user-managed OAuth app). Tokens are stored
 * encrypted and refreshed server-side; the provider receives a reference, never raw tokens.
 */
export interface MeetingConnection {
  provider: 'zoom';
  connectionId: string;
}

export interface MeetingSchedule {
  /** First occurrence, UTC. */
  startAt: Date;
  durationMinutes: number;
  /** Shown to participants; ReMix classes are always Asia/Colombo. */
  timezone: 'Asia/Colombo';
  /** Weekly recurrence on ISO weekdays (1 = Monday … 7 = Sunday) until `until`. */
  recurrence?: { weekdays: number[]; until: Date };
}

export interface Meeting {
  meetingId: string;
  /** Host start link — staff only, never shown to students. */
  startUrl: string;
}

/**
 * Live classes (Zoom). Meetings require registration with name lock, so each paid student gets
 * a personal join link from `addRegistrant` — no shared link to leak.
 */
export interface MeetingProvider {
  createMeeting(input: {
    tenantId: string;
    connection: MeetingConnection;
    topic: string;
    schedule: MeetingSchedule;
    idempotencyKey: string;
  }): Promise<Meeting>;
  addRegistrant(input: {
    tenantId: string;
    connection: MeetingConnection;
    meetingId: string;
    firstName: string;
    lastName: string;
    email: string;
    idempotencyKey: string;
  }): Promise<{ registrantId: string; joinUrl: string }>;
  deleteMeeting(input: {
    tenantId: string;
    connection: MeetingConnection;
    meetingId: string;
  }): Promise<void>;
}

/** DI token for {@link MeetingProvider}. */
export const MEETING_PROVIDER = Symbol('MeetingProvider');
