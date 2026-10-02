import { CallRecorder } from '../recorder';
import type {
  Meeting,
  MeetingConnection,
  MeetingProvider,
  MeetingSchedule,
} from './meeting.provider';

/** In-memory {@link MeetingProvider}: idempotent meetings and registrants. */
export class MockMeetingProvider
  extends CallRecorder<'createMeeting' | 'addRegistrant' | 'deleteMeeting'>
  implements MeetingProvider
{
  /** tenantId:meetingId → registrant ids. */
  readonly meetings = new Map<string, Set<string>>();
  private readonly byKey = new Map<string, Meeting>();
  private readonly registrants = new Map<string, { registrantId: string; joinUrl: string }>();

  async createMeeting(input: {
    tenantId: string;
    connection: MeetingConnection;
    topic: string;
    schedule: MeetingSchedule;
    idempotencyKey: string;
  }): Promise<Meeting> {
    await this.record('createMeeting', input);
    const { durationMinutes, recurrence } = input.schedule;
    if (!Number.isInteger(durationMinutes) || durationMinutes < 1) {
      throw new RangeError('durationMinutes must be a positive integer');
    }
    if (recurrence?.weekdays.some((d) => !Number.isInteger(d) || d < 1 || d > 7)) {
      throw new RangeError('weekdays are ISO 1–7');
    }
    const key = `${input.tenantId}:${input.idempotencyKey}`;
    const existing = this.byKey.get(key);
    if (existing) return existing;
    const meetingId = String(9_000_000_000 + this.byKey.size + 1);
    const meeting = { meetingId, startUrl: `https://meeting.mock.invalid/s/${meetingId}` };
    this.byKey.set(key, meeting);
    this.meetings.set(`${input.tenantId}:${meetingId}`, new Set());
    return meeting;
  }

  async addRegistrant(input: {
    tenantId: string;
    connection: MeetingConnection;
    meetingId: string;
    firstName: string;
    lastName: string;
    email: string;
    idempotencyKey: string;
  }): Promise<{ registrantId: string; joinUrl: string }> {
    await this.record('addRegistrant', input);
    const meeting = this.meetings.get(`${input.tenantId}:${input.meetingId}`);
    if (!meeting) throw new Error('Meeting not found for this tenant');
    const key = `${input.tenantId}:${input.idempotencyKey}`;
    const existing = this.registrants.get(key);
    if (existing) return existing;
    const registrantId = `mock-registrant-${this.registrants.size + 1}`;
    const result = {
      registrantId,
      joinUrl: `https://meeting.mock.invalid/w/${input.meetingId}?tk=${registrantId}`,
    };
    meeting.add(registrantId);
    this.registrants.set(key, result);
    return result;
  }

  async deleteMeeting(input: {
    tenantId: string;
    connection: MeetingConnection;
    meetingId: string;
  }): Promise<void> {
    await this.record('deleteMeeting', input);
    this.meetings.delete(`${input.tenantId}:${input.meetingId}`);
  }
}
