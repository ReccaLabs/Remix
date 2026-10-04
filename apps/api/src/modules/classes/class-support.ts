import { and, eq, inArray, type Column } from 'drizzle-orm';
import { schema, type Tx } from '@remix/db';
import type { AuthSession } from '../../common/auth/session-authenticator';
import { AppException } from '../../common/errors/app-exception';
import type { AuditEntry } from '../audit/audit.service';

const { tenantUsers, staffRoles } = schema;

export function validation(path: string, message: string): AppException {
  return new AppException('VALIDATION_FAILED', 400, 'Check the highlighted fields', {
    errors: [{ path, message }],
  });
}

export const classNotFound = () => new AppException('NOT_FOUND', 404, 'Class not found');

export const actor = (
  session: AuthSession,
  at: Date,
): Pick<AuditEntry, 'actorId' | 'actorKind' | 'at'> => ({
  actorId: session.userId,
  actorKind: 'staff',
  at,
});

/** Never matches a row; keeps `IN ()` valid for an empty teacher scope. */
export const NO_ID = '00000000-0000-0000-0000-000000000000';

/** `inArray` that is false (not a syntax error) for an empty list. */
export const inIds = (column: Column, ids: readonly string[]) =>
  inArray(column, ids.length > 0 ? [...ids] : [NO_ID]);

/** The teacher of a class must be an active staff member who holds the teacher role. */
export async function assertTeacher(tx: Tx, teacherId: string): Promise<void> {
  const [row] = await tx
    .select({ id: tenantUsers.id })
    .from(tenantUsers)
    .innerJoin(
      staffRoles,
      and(eq(staffRoles.tenantId, tenantUsers.tenantId), eq(staffRoles.userId, tenantUsers.id)),
    )
    .where(
      and(
        eq(tenantUsers.id, teacherId),
        eq(tenantUsers.kind, 'staff'),
        eq(tenantUsers.status, 'active'),
        eq(staffRoles.role, 'teacher'),
      ),
    );
  if (!row) throw validation('teacherId', 'Choose a teacher from your staff');
}

export interface Slot {
  weekday: number;
  startTime: string;
  durationMinutes: number;
}

/** A class cannot have the same weekday and start time twice. */
export function assertSchedule(schedule: readonly Slot[]): void {
  const seen = new Set<string>();
  for (const [i, slot] of schedule.entries()) {
    const key = `${slot.weekday}@${slot.startTime}`;
    if (seen.has(key)) throw validation(`schedule.${i}.startTime`, 'This time is listed twice');
    seen.add(key);
  }
}

// ---- dates (all calendar maths on `YYYY-MM-DD` strings, no time zones involved) -------------

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** ISO weekday (1 = Monday … 7 = Sunday) of a calendar date. */
export function isoWeekday(date: string): number {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay();
  return day === 0 ? 7 : day;
}

/** The Monday of the week that contains `date`. */
export const mondayOf = (date: string): string => addDays(date, 1 - isoWeekday(date));

/** First day of the month of `date`. */
export const monthOf = (date: string): string => `${date.slice(0, 7)}-01`;
