import { Inject, Injectable } from '@nestjs/common';
import { and, asc, count, eq, isNull, sql } from 'drizzle-orm';
import { schema, withTenant, type Db, type Tx } from '@remix/db';
import type { API, TimetableResponse, TimetableSlot } from '@remix/types/api';
import type { AuthSession } from '../../common/auth/session-authenticator';
import { calendarDate } from '../../common/time/business-date';
import { CLOCK, type Clock } from '../../common/time/clock';
import type { EndpointResult } from '../../common/validation/endpoint';
import { DB } from '../db/db.module';
import { visibleClassIds } from '../people/scope';
import { addDays, inIds, isoWeekday, mondayOf, monthOf, validation } from './class-support';

const { classes, classSchedules, enrollments, halls, students, tenantUsers } = schema;

/**
 * CLS-06 — the weekly timetable. A week runs Monday to Sunday and every date is an Asia/Colombo
 * calendar date; a class appears on each date of the week that matches one of its weekly slots
 * (from its `startsOn` date on). Archived classes are left out.
 */
@Injectable()
export class TimetableService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  today(): string {
    return calendarDate(this.clock.now());
  }

  /** `weekStart` must be a Monday; absent means the current week. */
  private resolveWeek(weekStart: string | undefined): string {
    if (weekStart === undefined) return mondayOf(this.today());
    if (isoWeekday(weekStart) !== 1) throw validation('weekStart', 'A week starts on a Monday');
    return weekStart;
  }

  /** Staff view with student counts; teachers only get their own classes (STF-02). */
  admin(
    tenantId: string,
    session: AuthSession,
    query: { weekStart?: string | undefined },
  ): Promise<TimetableResponse> {
    const weekStart = this.resolveWeek(query.weekStart);
    return withTenant(this.db, tenantId, async (tx) => {
      const scope = await visibleClassIds(tx, session);
      return { weekStart, slots: await this.week(tx, weekStart, scope) };
    });
  }

  /** Public website view: the same slots without student counts. */
  publicWeek(
    tenantId: string,
    query: { weekStart?: string | undefined },
  ): Promise<EndpointResult<typeof API.publicTimetable>> {
    const weekStart = this.resolveWeek(query.weekStart);
    return withTenant(this.db, tenantId, async (tx) => {
      const slots = await this.week(tx, weekStart, null);
      return {
        weekStart,
        // No student counts on the public site.
        slots: slots.map((slot) => ({
          classId: slot.classId,
          className: slot.className,
          grade: slot.grade,
          teacherName: slot.teacherName,
          hallName: slot.hallName,
          place: slot.place,
          date: slot.date,
          startTime: slot.startTime,
          durationMinutes: slot.durationMinutes,
        })),
      };
    });
  }

  /** Today's slots in start-time order (dashboard "Today's classes"). */
  async todaysSlots(tx: Tx, scope: readonly string[] | null): Promise<TimetableSlot[]> {
    const today = this.today();
    const slots = await this.week(tx, mondayOf(today), scope);
    return slots.filter((s) => s.date === today);
  }

  async week(tx: Tx, weekStart: string, scope: readonly string[] | null): Promise<TimetableSlot[]> {
    const rows = await tx
      .select({
        classId: classes.id,
        className: classes.name,
        grade: classes.grade,
        place: classes.place,
        startsOn: classes.startsOn,
        teacherName: tenantUsers.displayName,
        hallName: halls.name,
        weekday: classSchedules.weekday,
        startTime: classSchedules.startTime,
        durationMinutes: classSchedules.durationMinutes,
      })
      .from(classSchedules)
      .innerJoin(
        classes,
        and(eq(classes.tenantId, classSchedules.tenantId), eq(classes.id, classSchedules.classId)),
      )
      .leftJoin(
        tenantUsers,
        and(eq(tenantUsers.tenantId, classes.tenantId), eq(tenantUsers.id, classes.teacherId)),
      )
      .leftJoin(halls, and(eq(halls.tenantId, classes.tenantId), eq(halls.id, classes.hallId)))
      .where(and(isNull(classes.archivedAt), scope ? inIds(classes.id, scope) : undefined))
      .orderBy(asc(classSchedules.weekday), asc(classSchedules.startTime), asc(classes.name));

    const slots = rows
      .map((r) => ({ ...r, date: addDays(weekStart, r.weekday - 1) }))
      .filter((r) => r.startsOn === null || r.date >= r.startsOn);
    if (slots.length === 0) return [];

    // Enrolled students per class for each month the week touches (at most two).
    const classIds = [...new Set(slots.map((s) => s.classId))];
    const counts = new Map<string, number>();
    for (const month of new Set(slots.map((s) => monthOf(s.date)))) {
      const found = await tx
        .select({ classId: enrollments.classId, n: count() })
        .from(enrollments)
        .innerJoin(
          students,
          and(
            eq(students.tenantId, enrollments.tenantId),
            eq(students.userId, enrollments.studentId),
          ),
        )
        .where(
          and(
            inIds(enrollments.classId, classIds),
            isNull(students.archivedAt),
            sql`${enrollments.fromMonth} <= ${month}`,
            sql`(${enrollments.toMonth} is null or ${enrollments.toMonth} >= ${month})`,
          ),
        )
        .groupBy(enrollments.classId);
      for (const f of found) counts.set(`${month}|${f.classId}`, f.n);
    }

    return slots
      .map((s) => ({
        classId: s.classId,
        className: s.className,
        grade: s.grade,
        teacherName: s.teacherName,
        hallName: s.hallName,
        place: s.place,
        date: s.date,
        startTime: s.startTime.slice(0, 5),
        durationMinutes: s.durationMinutes,
        studentCount: counts.get(`${monthOf(s.date)}|${s.classId}`) ?? 0,
      }))
      .sort(
        (a, b) =>
          a.date.localeCompare(b.date) ||
          a.startTime.localeCompare(b.startTime) ||
          a.className.localeCompare(b.className),
      );
  }
}
