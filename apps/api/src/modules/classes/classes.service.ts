import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, ilike, inArray, isNotNull, isNull, or, sql, type SQL } from 'drizzle-orm';
import { schema, withTenant, type Db, type Tx } from '@remix/db';
import type { AdminClass, ClassDetail, ClassStudent, StudentEnrollment } from '@remix/types/api';
import type { API } from '@remix/types/api';
import type { z } from 'zod';
import type { AuthSession } from '../../common/auth/session-authenticator';
import { AppException } from '../../common/errors/app-exception';
import { monthStart } from '../../common/time/business-date';
import { CLOCK, type Clock } from '../../common/time/clock';
import type { EndpointBody } from '../../common/validation/endpoint';
import { AuditService, type AuditEntry } from '../audit/audit.service';
import { DB } from '../db/db.module';
import { monthBefore } from '../people/students.service';
import { visibleClassIds } from '../people/scope';
import {
  actor,
  assertSchedule,
  assertTeacher,
  classNotFound,
  inIds,
  validation,
} from './class-support';

const { classes, classSchedules, enrollments, halls, students, tenantUsers, staffRoles } = schema;

type ListQuery = z.output<(typeof API.listClasses)['query']>;
type CreateBody = EndpointBody<typeof API.createClass>;
type UpdateBody = EndpointBody<typeof API.updateClass>;
type EnrolBody = EndpointBody<typeof API.enrolStudents>;
type UpdateEnrollmentBody = EndpointBody<typeof API.updateEnrollment>;
type MoveBody = EndpointBody<typeof API.moveEnrollment>;

const escapeLike = (text: string) => text.replace(/[\\%_]/g, (c) => `\\${c}`);

/** Enrolments of non-archived students that cover `month` (the "enrolled" figure). */
const enrolledCount = (month: string) =>
  sql<number>`(select count(*)::int from ${enrollments} e
    join ${students} s on s.tenant_id = e.tenant_id and s.user_id = e.student_id
    where e.tenant_id = ${classes.tenantId} and e.class_id = ${classes.id}
      and s.archived_at is null and e.from_month <= ${month}
      and (e.to_month is null or e.to_month >= ${month}))`;

/**
 * CLS-01…04 — classes, their weekly schedule, enrolments and fee overrides. Every method runs in
 * the host tenant's `withTenant` transaction (RLS) and writes its audit rows in the same
 * transaction. Teachers (STF-02) only ever see the classes in their scope; they have no write
 * permission, which the controller enforces before any of this runs.
 */
@Injectable()
export class ClassesService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly audit: AuditService,
  ) {}

  teachers(tenantId: string) {
    return withTenant(this.db, tenantId, async (tx) => ({
      items: await tx
        .select({ id: tenantUsers.id, displayName: tenantUsers.displayName })
        .from(tenantUsers)
        .innerJoin(
          staffRoles,
          and(eq(staffRoles.tenantId, tenantUsers.tenantId), eq(staffRoles.userId, tenantUsers.id)),
        )
        .where(
          and(
            eq(tenantUsers.kind, 'staff'),
            eq(tenantUsers.status, 'active'),
            eq(staffRoles.role, 'teacher'),
          ),
        )
        .orderBy(asc(tenantUsers.displayName), asc(tenantUsers.id)),
    }));
  }

  // ----- CLS-01 list -------------------------------------------------------------------------

  list(tenantId: string, session: AuthSession, query: ListQuery) {
    const month = monthStart(this.clock.now());
    return withTenant(this.db, tenantId, async (tx) => {
      const scope = await visibleClassIds(tx, session);
      const conds: (SQL | undefined)[] = [
        query.archived === 'true' ? isNotNull(classes.archivedAt) : isNull(classes.archivedAt),
      ];
      if (scope) conds.push(inIds(classes.id, scope));
      if (query.q) conds.push(ilike(classes.name, `%${escapeLike(query.q)}%`));
      if (query.grade) conds.push(eq(classes.grade, query.grade));
      if (query.place) conds.push(eq(classes.place, query.place));
      if (query.teacherId) conds.push(eq(classes.teacherId, query.teacherId));
      return { items: await this.rows(tx, month, and(...conds)) };
    });
  }

  // ----- CLS-03 detail -----------------------------------------------------------------------

  get(tenantId: string, session: AuthSession, classId: string): Promise<ClassDetail> {
    return withTenant(this.db, tenantId, (tx) => this.detail(tx, session, classId));
  }

  /** Loads one class with its KPIs; 404 when missing or outside a teacher's scope. */
  private async detail(tx: Tx, session: AuthSession, classId: string): Promise<ClassDetail> {
    const scope = await visibleClassIds(tx, session);
    if (scope && !scope.includes(classId)) throw classNotFound();
    const month = monthStart(this.clock.now());
    const [row] = await this.rows(tx, month, eq(classes.id, classId));
    if (!row) throw classNotFound();
    return {
      ...row,
      kpis: {
        enrolled: row.studentCount,
        // Fees arrive in Phase 3, attendance in Phase 5: null renders as "—".
        paid: null,
        unpaid: null,
        avgAttendancePercent: null,
      },
    };
  }

  /** Classes with teacher, hall, schedule and enrolled count — three queries, never one per class. */
  private async rows(tx: Tx, month: string, where: SQL | undefined): Promise<AdminClass[]> {
    const found = await tx
      .select({
        id: classes.id,
        name: classes.name,
        grade: classes.grade,
        medium: classes.medium,
        teacherId: classes.teacherId,
        teacherName: tenantUsers.displayName,
        feeCents: classes.feeCents,
        place: classes.place,
        hallId: classes.hallId,
        hallName: halls.name,
        startsOn: classes.startsOn,
        archivedAt: classes.archivedAt,
        studentCount: enrolledCount(month),
      })
      .from(classes)
      .leftJoin(
        tenantUsers,
        and(eq(tenantUsers.tenantId, classes.tenantId), eq(tenantUsers.id, classes.teacherId)),
      )
      .leftJoin(halls, and(eq(halls.tenantId, classes.tenantId), eq(halls.id, classes.hallId)))
      .where(where)
      .orderBy(asc(classes.name), asc(classes.id));
    if (found.length === 0) return [];

    const slots = await tx
      .select({
        classId: classSchedules.classId,
        weekday: classSchedules.weekday,
        startTime: classSchedules.startTime,
        durationMinutes: classSchedules.durationMinutes,
      })
      .from(classSchedules)
      .where(
        inArray(
          classSchedules.classId,
          found.map((c) => c.id),
        ),
      )
      .orderBy(asc(classSchedules.weekday), asc(classSchedules.startTime), asc(classSchedules.id));
    const byClass = new Map<string, AdminClass['schedule']>();
    for (const s of slots) {
      byClass.set(s.classId, [
        ...(byClass.get(s.classId) ?? []),
        {
          weekday: s.weekday,
          startTime: s.startTime.slice(0, 5),
          durationMinutes: s.durationMinutes,
        },
      ]);
    }
    return found.map((c) => ({
      id: c.id,
      name: c.name,
      grade: c.grade,
      medium: c.medium,
      teacherId: c.teacherId,
      teacherName: c.teacherName,
      feeCents: c.feeCents,
      place: c.place,
      hallId: c.hallId,
      hallName: c.hallName,
      startsOn: c.startsOn,
      schedule: byClass.get(c.id) ?? [],
      studentCount: c.studentCount,
      paidPercent: null,
      archivedAt: c.archivedAt?.toISOString() ?? null,
    }));
  }

  // ----- CLS-02 create / edit / archive ------------------------------------------------------

  create(tenantId: string, session: AuthSession, body: CreateBody): Promise<ClassDetail> {
    const now = this.clock.now();
    return withTenant(this.db, tenantId, async (tx) => {
      assertSchedule(body.schedule);
      if (body.teacherId) await assertTeacher(tx, body.teacherId);
      if (body.hallId) await this.assertHall(tx, body.hallId);

      const [row] = await tx
        .insert(classes)
        .values({
          tenantId,
          name: body.name,
          grade: body.grade,
          medium: body.medium,
          teacherId: body.teacherId,
          feeCents: body.feeCents,
          place: body.place,
          hallId: body.hallId,
          startsOn: body.startsOn,
        })
        .returning({ id: classes.id });
      if (!row) throw new Error('class not created');
      if (body.schedule.length > 0) {
        await tx
          .insert(classSchedules)
          .values(body.schedule.map((s) => ({ tenantId, classId: row.id, ...s })));
      }
      await this.audit.record(tx, tenantId, {
        ...actor(session, now),
        action: 'class.create',
        entity: 'class',
        entityId: row.id,
        after: {
          name: body.name,
          feeCents: body.feeCents,
          place: body.place,
          teacherId: body.teacherId,
          hallId: body.hallId,
          slots: body.schedule.length,
        },
      });
      return this.detail(tx, session, row.id);
    });
  }

  update(
    tenantId: string,
    session: AuthSession,
    classId: string,
    body: UpdateBody,
  ): Promise<ClassDetail> {
    const now = this.clock.now();
    return withTenant(this.db, tenantId, async (tx) => {
      const [current] = await tx
        .select()
        .from(classes)
        .where(eq(classes.id, classId))
        .for('update');
      if (!current) throw classNotFound();

      if (body.schedule) assertSchedule(body.schedule);
      if (body.teacherId) await assertTeacher(tx, body.teacherId);
      if (body.hallId) await this.assertHall(tx, body.hallId);

      const place = body.place ?? current.place;
      let hallId = body.hallId === undefined ? current.hallId : body.hallId;
      // Moving a class online drops its hall unless the caller said otherwise (and that would
      // be a contradiction).
      if (place === 'online') {
        if (body.hallId) throw validation('hallId', 'Online classes have no hall');
        hallId = null;
      }

      const changes: Partial<typeof classes.$inferInsert> = { hallId };
      if (body.name !== undefined) changes.name = body.name;
      if (body.grade !== undefined) changes.grade = body.grade;
      if (body.medium !== undefined) changes.medium = body.medium;
      if (body.teacherId !== undefined) changes.teacherId = body.teacherId;
      if (body.feeCents !== undefined) changes.feeCents = body.feeCents;
      if (body.place !== undefined) changes.place = body.place;
      if (body.startsOn !== undefined) changes.startsOn = body.startsOn;
      await tx.update(classes).set(changes).where(eq(classes.id, classId));

      if (body.schedule) {
        await tx.delete(classSchedules).where(eq(classSchedules.classId, classId));
        if (body.schedule.length > 0) {
          await tx
            .insert(classSchedules)
            .values(body.schedule.map((s) => ({ tenantId, classId, ...s })));
        }
      }

      const before: Record<string, unknown> = {};
      const after: Record<string, unknown> = {};
      for (const key of [
        'name',
        'grade',
        'medium',
        'teacherId',
        'feeCents',
        'place',
        'hallId',
        'startsOn',
      ] as const) {
        if (changes[key] !== undefined && changes[key] !== current[key]) {
          before[key] = current[key];
          after[key] = changes[key];
        }
      }
      if (body.schedule) after.slots = body.schedule.length;
      await this.audit.record(tx, tenantId, {
        ...actor(session, now),
        action: 'class.update',
        entity: 'class',
        entityId: classId,
        before,
        after,
      });
      return this.detail(tx, session, classId);
    });
  }

  /** Archiving keeps enrolments and history; the class leaves lists, pickers and timetables. */
  archive(tenantId: string, session: AuthSession, classId: string): Promise<undefined> {
    const now = this.clock.now();
    return withTenant(this.db, tenantId, async (tx) => {
      const [current] = await tx
        .select({ archivedAt: classes.archivedAt })
        .from(classes)
        .where(eq(classes.id, classId));
      if (!current) throw classNotFound();
      if (current.archivedAt) return undefined; // already archived: nothing to do
      await tx.update(classes).set({ archivedAt: now }).where(eq(classes.id, classId));
      await this.audit.record(tx, tenantId, {
        ...actor(session, now),
        action: 'class.archive',
        entity: 'class',
        entityId: classId,
      });
      return undefined;
    });
  }

  // ----- CLS-03 students tab -----------------------------------------------------------------

  /** Students whose enrolment is current or upcoming (not yet ended), archived students left out. */
  classStudents(
    tenantId: string,
    session: AuthSession,
    classId: string,
  ): Promise<{ items: ClassStudent[] }> {
    const month = monthStart(this.clock.now());
    return withTenant(this.db, tenantId, async (tx) => {
      const scope = await visibleClassIds(tx, session);
      if (scope && !scope.includes(classId)) throw classNotFound();
      const [cls] = await tx
        .select({ feeCents: classes.feeCents })
        .from(classes)
        .where(eq(classes.id, classId));
      if (!cls) throw classNotFound();
      const rows = await tx
        .select({
          enrollmentId: enrollments.id,
          studentId: enrollments.studentId,
          studentNo: students.studentNo,
          displayName: tenantUsers.displayName,
          phone: tenantUsers.phone,
          fromMonth: enrollments.fromMonth,
          toMonth: enrollments.toMonth,
          feeOverrideCents: enrollments.feeOverrideCents,
          reason: enrollments.reason,
        })
        .from(enrollments)
        .innerJoin(
          students,
          and(
            eq(students.tenantId, enrollments.tenantId),
            eq(students.userId, enrollments.studentId),
          ),
        )
        .innerJoin(
          tenantUsers,
          and(eq(tenantUsers.tenantId, students.tenantId), eq(tenantUsers.id, students.userId)),
        )
        .where(
          and(
            eq(enrollments.classId, classId),
            isNull(students.archivedAt),
            or(isNull(enrollments.toMonth), sql`${enrollments.toMonth} >= ${month}`),
          ),
        )
        .orderBy(asc(tenantUsers.displayName), asc(enrollments.fromMonth), asc(enrollments.id));
      return {
        items: rows.map((r) => ({
          enrollmentId: r.enrollmentId,
          studentId: r.studentId,
          studentNo: r.studentNo,
          displayName: r.displayName,
          phone: r.phone ?? '',
          fromMonth: r.fromMonth,
          toMonth: r.toMonth,
          feeCents: r.feeOverrideCents ?? cls.feeCents,
          feeOverrideCents: r.feeOverrideCents,
          reason: r.reason,
        })),
      };
    });
  }

  // ----- CLS-04 enrol / change / move --------------------------------------------------------

  /**
   * Enrols students from `fromMonth`. Students who are already enrolled in the class for that
   * month or later, and ids that are not (active) students of this institute, are skipped and
   * reported — the rest are enrolled. The class row is locked so two enrolments cannot race.
   */
  enrol(
    tenantId: string,
    session: AuthSession,
    classId: string,
    body: EnrolBody,
  ): Promise<{ enrolled: number; skipped: string[] }> {
    const now = this.clock.now();
    const ids = [...new Set(body.studentIds)];
    return withTenant(this.db, tenantId, async (tx) => {
      const [cls] = await tx.select().from(classes).where(eq(classes.id, classId)).for('update');
      if (!cls) throw classNotFound();
      if (cls.archivedAt) throw validation('classId', 'Archived classes cannot take new students');

      const active = await tx
        .select({ id: students.userId })
        .from(students)
        .where(and(inArray(students.userId, ids), isNull(students.archivedAt)));
      const activeIds = new Set(active.map((s) => s.id));
      const taken = await tx
        .select({ studentId: enrollments.studentId })
        .from(enrollments)
        .where(
          and(
            eq(enrollments.classId, classId),
            inArray(enrollments.studentId, ids),
            or(isNull(enrollments.toMonth), sql`${enrollments.toMonth} >= ${body.fromMonth}`),
          ),
        );
      const takenIds = new Set(taken.map((t) => t.studentId));
      const toEnrol = ids.filter((id) => activeIds.has(id) && !takenIds.has(id));
      const skipped = ids.filter((id) => !toEnrol.includes(id));

      const override = body.feeOverrideCents;
      if (toEnrol.length > 0) {
        const created = await tx
          .insert(enrollments)
          .values(
            toEnrol.map((studentId) => ({
              tenantId,
              classId,
              studentId,
              fromMonth: body.fromMonth,
              feeOverrideCents: override,
              reason: override === null ? null : body.reason,
            })),
          )
          .returning({ id: enrollments.id, studentId: enrollments.studentId });
        const entries: AuditEntry[] = created.flatMap((e) => [
          {
            ...actor(session, now),
            action: 'enrollment.create' as const,
            entity: 'enrollment',
            entityId: e.id,
            after: { classId, studentId: e.studentId, fromMonth: body.fromMonth },
          },
          ...(override === null
            ? []
            : [
                {
                  ...actor(session, now),
                  action: 'enrollment.fee_override' as const,
                  entity: 'enrollment',
                  entityId: e.id,
                  before: { feeCents: cls.feeCents },
                  after: { feeOverrideCents: override, reason: body.reason },
                },
              ]),
        ]);
        await this.audit.recordMany(tx, tenantId, entries);
      }
      return { enrolled: toEnrol.length, skipped };
    });
  }

  /** Changes the fee override (reason required) and/or ends or re-opens the enrolment. */
  updateEnrollment(
    tenantId: string,
    session: AuthSession,
    enrollmentId: string,
    body: UpdateEnrollmentBody,
  ): Promise<StudentEnrollment> {
    const now = this.clock.now();
    return withTenant(this.db, tenantId, async (tx) => {
      const [current] = await tx
        .select()
        .from(enrollments)
        .where(eq(enrollments.id, enrollmentId))
        .for('update');
      if (!current) throw enrollmentNotFound();

      const changes: Partial<typeof enrollments.$inferInsert> = {};
      const entries: AuditEntry[] = [];
      const base = { ...actor(session, now), entity: 'enrollment', entityId: enrollmentId };

      if (body.feeOverrideCents !== undefined) {
        changes.feeOverrideCents = body.feeOverrideCents;
        changes.reason = body.feeOverrideCents === null ? (body.reason ?? null) : body.reason;
      } else if (body.reason !== undefined) {
        if (body.reason === null && current.feeOverrideCents !== null) {
          throw validation('reason', 'Give a reason for the fee change');
        }
        changes.reason = body.reason;
      }
      if (
        body.feeOverrideCents !== undefined &&
        body.feeOverrideCents !== current.feeOverrideCents
      ) {
        entries.push({
          ...base,
          action: 'enrollment.fee_override',
          before: { feeOverrideCents: current.feeOverrideCents, reason: current.reason },
          after: { feeOverrideCents: body.feeOverrideCents, reason: changes.reason ?? null },
        });
      }

      if (body.toMonth !== undefined) {
        if (body.toMonth !== null && body.toMonth < current.fromMonth) {
          throw validation('toMonth', 'The last month cannot be before the first month');
        }
        if (body.toMonth === null) {
          // Re-opening must not overlap another enrolment of the same student in this class.
          const [clash] = await tx
            .select({ id: enrollments.id })
            .from(enrollments)
            .where(
              and(
                eq(enrollments.classId, current.classId),
                eq(enrollments.studentId, current.studentId),
                sql`${enrollments.id} <> ${enrollmentId}`,
                or(
                  isNull(enrollments.toMonth),
                  sql`${enrollments.toMonth} >= ${current.fromMonth}`,
                ),
              ),
            );
          if (clash) throw alreadyEnrolled();
        }
        changes.toMonth = body.toMonth;
        if (body.toMonth !== current.toMonth) {
          entries.push({
            ...base,
            action: 'enrollment.end',
            before: { toMonth: current.toMonth },
            after: { toMonth: body.toMonth },
          });
        }
      }

      await tx.update(enrollments).set(changes).where(eq(enrollments.id, enrollmentId));
      entries.unshift({
        ...base,
        action: 'enrollment.update',
        after: { fields: Object.keys(body) },
      });
      await this.audit.recordMany(tx, tenantId, entries);
      return this.enrollment(tx, enrollmentId);
    });
  }

  /**
   * Moves a student to another class from `fromMonth`: the current enrolment ends the month
   * before (or, when it started that very month, is re-pointed) and a new one opens in the new
   * class with the same end month and fee override. One transaction — no half-moves.
   */
  moveEnrollment(
    tenantId: string,
    session: AuthSession,
    enrollmentId: string,
    body: MoveBody,
  ): Promise<StudentEnrollment> {
    const now = this.clock.now();
    return withTenant(this.db, tenantId, async (tx) => {
      const [current] = await tx
        .select()
        .from(enrollments)
        .where(eq(enrollments.id, enrollmentId))
        .for('update');
      if (!current) throw enrollmentNotFound();
      if (body.toClassId === current.classId) {
        throw validation('toClassId', 'Choose a different class');
      }

      const [target] = await tx
        .select({ id: classes.id, archivedAt: classes.archivedAt })
        .from(classes)
        .where(eq(classes.id, body.toClassId))
        .for('update');
      if (!target) throw validation('toClassId', 'Choose an existing class');
      if (target.archivedAt) {
        throw validation('toClassId', 'Archived classes cannot take new students');
      }
      if (current.fromMonth > body.fromMonth) {
        throw validation('fromMonth', 'Choose a month after the enrolment started');
      }
      if (current.toMonth && current.toMonth < body.fromMonth) {
        throw validation('fromMonth', 'This enrolment has already ended');
      }
      const [clash] = await tx
        .select({ id: enrollments.id })
        .from(enrollments)
        .where(
          and(
            eq(enrollments.classId, body.toClassId),
            eq(enrollments.studentId, current.studentId),
            or(isNull(enrollments.toMonth), sql`${enrollments.toMonth} >= ${body.fromMonth}`),
          ),
        );
      if (clash) throw alreadyEnrolled();

      let resultId = enrollmentId;
      if (current.fromMonth === body.fromMonth) {
        await tx
          .update(enrollments)
          .set({ classId: body.toClassId })
          .where(eq(enrollments.id, enrollmentId));
      } else {
        await tx
          .update(enrollments)
          .set({ toMonth: monthBefore(body.fromMonth) })
          .where(eq(enrollments.id, enrollmentId));
        const [created] = await tx
          .insert(enrollments)
          .values({
            tenantId,
            classId: body.toClassId,
            studentId: current.studentId,
            fromMonth: body.fromMonth,
            toMonth: current.toMonth,
            feeOverrideCents: current.feeOverrideCents,
            reason: current.reason,
          })
          .returning({ id: enrollments.id });
        if (!created) throw new Error('enrolment not created');
        resultId = created.id;
      }
      await this.audit.record(tx, tenantId, {
        ...actor(session, now),
        action: 'enrollment.move',
        entity: 'enrollment',
        entityId: resultId,
        before: { enrollmentId, classId: current.classId },
        after: {
          studentId: current.studentId,
          toClassId: body.toClassId,
          fromMonth: body.fromMonth,
        },
      });
      return this.enrollment(tx, resultId);
    });
  }

  private async enrollment(tx: Tx, id: string): Promise<StudentEnrollment> {
    const [row] = await tx
      .select({
        id: enrollments.id,
        classId: enrollments.classId,
        className: classes.name,
        fromMonth: enrollments.fromMonth,
        toMonth: enrollments.toMonth,
        classFeeCents: classes.feeCents,
        feeOverrideCents: enrollments.feeOverrideCents,
        reason: enrollments.reason,
      })
      .from(enrollments)
      .innerJoin(
        classes,
        and(eq(classes.tenantId, enrollments.tenantId), eq(classes.id, enrollments.classId)),
      )
      .where(eq(enrollments.id, id));
    if (!row) throw enrollmentNotFound();
    return {
      id: row.id,
      classId: row.classId,
      className: row.className,
      fromMonth: row.fromMonth,
      toMonth: row.toMonth,
      feeCents: row.feeOverrideCents ?? row.classFeeCents,
      feeOverrideCents: row.feeOverrideCents,
      reason: row.reason,
    };
  }

  private async assertHall(tx: Tx, hallId: string): Promise<void> {
    const [row] = await tx.select({ id: halls.id }).from(halls).where(eq(halls.id, hallId));
    if (!row) throw validation('hallId', 'Choose an existing hall');
  }
}

const enrollmentNotFound = () => new AppException('NOT_FOUND', 404, 'Enrolment not found');
const alreadyEnrolled = () =>
  new AppException('CONFLICT', 409, 'This student is already enrolled in that class');
