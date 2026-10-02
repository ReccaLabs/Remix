import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, gte, inArray, isNull, lte, or, sql } from 'drizzle-orm';
import { schema, withTenant, type Db } from '@remix/db';
import type { ClassSummary } from '@remix/types/api';
import { monthStart } from '../../common/time/business-date';
import { CLOCK, type Clock } from '../../common/time/clock';
import { DB } from '../db/db.module';

const { enrollments, classes, classSchedules, tenantUsers } = schema;

/**
 * `GET /me/classes`: the student's classes for the current billing month in Asia/Colombo
 * (`from_month <= month AND (to_month IS NULL OR to_month >= month)`), archived classes
 * excluded. Two queries regardless of how many classes (no N+1): enrolments with class and
 * teacher, then every schedule of those classes. Ordered by class name, then id.
 */
@Injectable()
export class MyClassesService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  list(tenantId: string, studentId: string): Promise<ClassSummary[]> {
    const month = monthStart(this.clock.now());
    return withTenant(this.db, tenantId, async (tx) => {
      const rows = await tx
        .select({
          id: classes.id,
          name: classes.name,
          grade: classes.grade,
          medium: classes.medium,
          place: classes.place,
          teacherName: tenantUsers.displayName,
          feeCents:
            sql<number>`coalesce(${enrollments.feeOverrideCents}, ${classes.feeCents})`.mapWith(
              Number,
            ),
        })
        .from(enrollments)
        .innerJoin(
          classes,
          and(eq(classes.tenantId, enrollments.tenantId), eq(classes.id, enrollments.classId)),
        )
        .leftJoin(
          tenantUsers,
          and(eq(tenantUsers.tenantId, classes.tenantId), eq(tenantUsers.id, classes.teacherId)),
        )
        .where(
          and(
            eq(enrollments.tenantId, tenantId),
            eq(enrollments.studentId, studentId),
            lte(enrollments.fromMonth, month),
            or(isNull(enrollments.toMonth), gte(enrollments.toMonth, month)),
            isNull(classes.archivedAt),
          ),
        )
        // The most recent enrolment wins if a class appears twice for the month.
        .orderBy(asc(classes.name), asc(classes.id), desc(enrollments.fromMonth));

      const byClass = new Map<string, (typeof rows)[number]>();
      for (const row of rows) if (!byClass.has(row.id)) byClass.set(row.id, row);
      if (byClass.size === 0) return [];

      const slots = await tx
        .select({
          classId: classSchedules.classId,
          weekday: classSchedules.weekday,
          startTime: classSchedules.startTime,
          durationMinutes: classSchedules.durationMinutes,
        })
        .from(classSchedules)
        .where(
          and(
            eq(classSchedules.tenantId, tenantId),
            inArray(classSchedules.classId, [...byClass.keys()]),
          ),
        )
        .orderBy(
          asc(classSchedules.weekday),
          asc(classSchedules.startTime),
          asc(classSchedules.id),
        );

      return [...byClass.values()].map((row) => ({
        id: row.id,
        name: row.name,
        grade: row.grade,
        medium: row.medium,
        place: row.place,
        teacherName: row.teacherName,
        feeCents: row.feeCents,
        schedule: slots
          .filter((s) => s.classId === row.id)
          .map((s) => ({
            weekday: s.weekday,
            startTime: s.startTime.slice(0, 5),
            durationMinutes: s.durationMinutes,
          })),
      }));
    });
  }
}
