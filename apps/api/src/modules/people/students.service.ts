import { Inject, Injectable } from '@nestjs/common';
import {
  and,
  asc,
  count,
  desc,
  eq,
  ilike,
  inArray,
  isNotNull,
  isNull,
  ne,
  or,
  sql,
  type SQL,
} from 'drizzle-orm';
import { allocateNumbers, formatStudentNo, schema, withTenant, type Db, type Tx } from '@remix/db';
import { can } from '@remix/types';
import type {
  BulkResult,
  ListStudentsResponse,
  StudentListItem,
  StudentProfile,
  StudentStatus,
} from '@remix/types/api';
import type { API } from '@remix/types/api';
import type { z } from 'zod';
import type { AuthSession } from '../../common/auth/session-authenticator';
import { AppException } from '../../common/errors/app-exception';
import { monthStart } from '../../common/time/business-date';
import { CLOCK, type Clock } from '../../common/time/clock';
import type { EndpointBody } from '../../common/validation/endpoint';
import { AuditService, type AuditEntry } from '../audit/audit.service';
import { DB } from '../db/db.module';
import { PeopleHooks } from './people-hooks';
import { isUniqueViolation, visibleClassIds } from './scope';

const { tenantUsers, students, guardians, enrollments, classes, devices, sessions, tenants } =
  schema;

type ListQuery = z.output<(typeof API.listStudents)['query']>;
type CreateBody = EndpointBody<typeof API.createStudent>;
type UpdateBody = EndpointBody<typeof API.updateStudent>;
type BulkBody = EndpointBody<typeof API.bulkStudents>;
type GuardianBody = CreateBody['guardians'];

const STAFF_SIGN_OUT = 'signed_out_by_staff';

/** What a student's lifecycle looks like to staff: archived beats invited beats active. */
export function studentStatus(
  archivedAt: Date | null,
  userStatus: 'active' | 'disabled' | 'invited',
): StudentStatus {
  if (archivedAt) return 'archived';
  return userStatus === 'invited' ? 'invited' : 'active';
}

const escapeLike = (text: string) => text.replace(/[\\%_]/g, (c) => `\\${c}`);
const sqlList = (ids: readonly string[]) =>
  sql.join(
    ids.map((id) => sql`${id}::uuid`),
    sql`, `,
  );

/** `exists` an enrolment that covers `month`, optionally restricted to some classes. */
function enrolledNow(month: string, classIds?: readonly string[]): SQL {
  const inClasses =
    classIds === undefined
      ? sql``
      : classIds.length === 0
        ? sql`and false`
        : sql`and e.class_id in (${sqlList(classIds)})`;
  return sql`exists (select 1 from ${enrollments} e
    where e.tenant_id = ${students.tenantId} and e.student_id = ${students.userId}
      and e.from_month <= ${month} and (e.to_month is null or e.to_month >= ${month}) ${inClasses})`;
}

function validation(path: string, message: string): AppException {
  return new AppException('VALIDATION_FAILED', 400, 'Check the highlighted fields', {
    errors: [{ path, message }],
  });
}

const notFound = () => new AppException('NOT_FOUND', 404, 'Student not found');

/**
 * STU-01/02/03/05/07 and PAR-01/03 — students as staff see them. Every method runs inside the
 * host tenant's `withTenant` transaction (RLS), applies the class scope of teachers (STF-02) and
 * writes its audit rows in the same transaction.
 */
@Injectable()
export class StudentsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly audit: AuditService,
    private readonly hooks: PeopleHooks,
  ) {}

  // ----- STU-01 list -------------------------------------------------------------------------

  list(tenantId: string, session: AuthSession, query: ListQuery): Promise<ListStudentsResponse> {
    const month = monthStart(this.clock.now());
    return withTenant(this.db, tenantId, async (tx) => {
      const scope = await visibleClassIds(tx, session);
      const conds: (SQL | undefined)[] = [eq(students.tenantId, tenantId)];

      if (query.status === 'archived') conds.push(isNotNull(students.archivedAt));
      else conds.push(isNull(students.archivedAt));
      if (query.status === 'invited') conds.push(eq(tenantUsers.status, 'invited'));
      if (query.status === 'active') conds.push(ne(tenantUsers.status, 'invited'));

      if (query.q) {
        const needles = [ilike(tenantUsers.displayName, `%${escapeLike(query.q)}%`)];
        needles.push(ilike(students.studentNo, `%${escapeLike(query.q)}%`));
        const digits = query.q.replace(/[\s-]/g, '');
        if (/^\+?\d{3,}$/.test(digits)) {
          const national = digits.replace(/^\+?(?:94)?0?/, '');
          needles.push(ilike(tenantUsers.phone, `%${escapeLike(national || digits)}%`));
        }
        conds.push(or(...needles));
      }

      if (query.classId) {
        // A teacher asking for a class outside their scope sees an empty table, not an error.
        if (scope && !scope.includes(query.classId)) conds.push(sql`false`);
        else conds.push(enrolledNow(month, [query.classId]));
      } else if (scope) {
        conds.push(enrolledNow(month, scope));
      }

      if (query.minDevices) {
        conds.push(
          sql`(select count(*) from ${devices} d where d.tenant_id = ${students.tenantId}
            and d.user_id = ${students.userId} and d.signed_out_at is null) >= ${query.minDevices}`,
        );
      }
      if (query.joinedFrom) {
        conds.push(
          sql`(${tenantUsers.createdAt} at time zone 'Asia/Colombo')::date >= ${query.joinedFrom}::date`,
        );
      }
      if (query.joinedTo) {
        conds.push(
          sql`(${tenantUsers.createdAt} at time zone 'Asia/Colombo')::date <= ${query.joinedTo}::date`,
        );
      }
      const where = and(...conds);

      const join = and(
        eq(tenantUsers.tenantId, students.tenantId),
        eq(tenantUsers.id, students.userId),
      );
      const [totalRow] = await tx
        .select({ n: count() })
        .from(students)
        .innerJoin(tenantUsers, join)
        .where(where);

      const order =
        query.sort === 'studentNo'
          ? [asc(students.studentNo), asc(students.userId)]
          : query.sort === 'joined'
            ? [desc(tenantUsers.createdAt), desc(students.userId)]
            : [asc(tenantUsers.displayName), asc(students.userId)];
      const rows = await tx
        .select({
          id: students.userId,
          studentNo: students.studentNo,
          displayName: tenantUsers.displayName,
          phone: tenantUsers.phone,
          school: students.school,
          alYear: students.alYear,
          archivedAt: students.archivedAt,
          userStatus: tenantUsers.status,
          createdAt: tenantUsers.createdAt,
        })
        .from(students)
        .innerJoin(tenantUsers, join)
        .where(where)
        .orderBy(...order)
        .limit(query.pageSize)
        .offset((query.page - 1) * query.pageSize);

      const ids = rows.map((r) => r.id);
      // Sequential: one transaction is one connection, which runs one query at a time.
      const classRows = ids.length
        ? await tx
            .select({ studentId: enrollments.studentId, name: classes.name })
            .from(enrollments)
            .innerJoin(
              classes,
              and(eq(classes.tenantId, enrollments.tenantId), eq(classes.id, enrollments.classId)),
            )
            .where(
              and(
                eq(enrollments.tenantId, tenantId),
                inArray(enrollments.studentId, ids),
                sql`${enrollments.fromMonth} <= ${month}`,
                sql`(${enrollments.toMonth} is null or ${enrollments.toMonth} >= ${month})`,
                scope ? inArray(classes.id, scope.length ? scope : [NO_ID]) : undefined,
              ),
            )
            .orderBy(asc(classes.name))
        : [];
      const deviceRows = ids.length
        ? await tx
            .select({ userId: devices.userId, n: count() })
            .from(devices)
            .where(
              and(
                eq(devices.tenantId, tenantId),
                inArray(devices.userId, ids),
                isNull(devices.signedOutAt),
              ),
            )
            .groupBy(devices.userId)
        : [];
      const classNames = new Map<string, string[]>();
      for (const c of classRows) {
        classNames.set(c.studentId, [...(classNames.get(c.studentId) ?? []), c.name]);
      }
      const deviceCounts = new Map(deviceRows.map((d) => [d.userId, d.n]));

      const items: StudentListItem[] = rows.map((r) => ({
        id: r.id,
        studentNo: r.studentNo,
        displayName: r.displayName,
        phone: r.phone ?? '',
        school: r.school,
        alYear: r.alYear,
        status: studentStatus(r.archivedAt, r.userStatus),
        classNames: classNames.get(r.id) ?? [],
        activeDevices: deviceCounts.get(r.id) ?? 0,
        joinedAt: r.createdAt.toISOString(),
      }));
      return { page: query.page, pageSize: query.pageSize, total: totalRow?.n ?? 0, items };
    });
  }

  // ----- STU-05 profile ----------------------------------------------------------------------

  get(tenantId: string, session: AuthSession, studentId: string): Promise<StudentProfile> {
    return withTenant(this.db, tenantId, (tx) => this.profile(tx, session, studentId));
  }

  /** Loads one profile; 404 when it does not exist or a teacher's scope does not cover it. */
  private async profile(tx: Tx, session: AuthSession, studentId: string): Promise<StudentProfile> {
    const month = monthStart(this.clock.now());
    const scope = await visibleClassIds(tx, session);
    const [row] = await tx
      .select({
        id: students.userId,
        studentNo: students.studentNo,
        displayName: tenantUsers.displayName,
        phone: tenantUsers.phone,
        school: students.school,
        alYear: students.alYear,
        medium: students.medium,
        under18: students.under18,
        consentGivenBy: students.consentGivenBy,
        consentMethod: students.consentMethod,
        consentRecordedAt: students.consentRecordedAt,
        archivedAt: students.archivedAt,
        userStatus: tenantUsers.status,
        createdAt: tenantUsers.createdAt,
      })
      .from(students)
      .innerJoin(
        tenantUsers,
        and(eq(tenantUsers.tenantId, students.tenantId), eq(tenantUsers.id, students.userId)),
      )
      .where(eq(students.userId, studentId));
    if (!row) throw notFound();

    const enrolmentRows = await tx
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
      .where(eq(enrollments.studentId, studentId))
      .orderBy(desc(enrollments.fromMonth), asc(classes.name));

    if (scope) {
      const covered = enrolmentRows.some(
        (e) =>
          scope.includes(e.classId) && e.fromMonth <= month && (!e.toMonth || e.toMonth >= month),
      );
      if (!covered) throw notFound();
    }
    const visibleEnrolments = scope
      ? enrolmentRows.filter((e) => scope.includes(e.classId))
      : enrolmentRows;

    const guardianRows = await tx
      .select()
      .from(guardians)
      .where(eq(guardians.studentId, studentId))
      .orderBy(asc(guardians.createdAt), asc(guardians.id));
    // Device details are for roles that may manage them (AUTH-08), not every reader.
    const deviceRows = can(session.roles, 'students.devices')
      ? await tx
          .select()
          .from(devices)
          .where(and(eq(devices.userId, studentId), isNull(devices.signedOutAt)))
          .orderBy(desc(devices.lastSeenAt))
      : [];
    const activeDevices = await tx
      .select({ n: count() })
      .from(devices)
      .where(and(eq(devices.userId, studentId), isNull(devices.signedOutAt)));

    const classNames = visibleEnrolments
      .filter((e) => e.fromMonth <= month && (!e.toMonth || e.toMonth >= month))
      .map((e) => e.className)
      .sort();

    return {
      id: row.id,
      studentNo: row.studentNo,
      displayName: row.displayName,
      phone: row.phone ?? '',
      school: row.school,
      alYear: row.alYear,
      status: studentStatus(row.archivedAt, row.userStatus),
      classNames,
      activeDevices: activeDevices[0]?.n ?? 0,
      joinedAt: row.createdAt.toISOString(),
      medium: row.medium,
      under18: row.under18,
      consent:
        row.consentGivenBy && row.consentMethod && row.consentRecordedAt
          ? {
              givenBy: row.consentGivenBy,
              method: row.consentMethod,
              recordedAt: row.consentRecordedAt.toISOString(),
            }
          : null,
      guardians: guardianRows.map((g) => ({
        id: g.id,
        name: g.name,
        relation: g.relation,
        phone: g.phone,
        smsOptIn: g.smsOptIn,
      })),
      enrollments: visibleEnrolments.map((e) => ({
        id: e.id,
        classId: e.classId,
        className: e.className,
        fromMonth: e.fromMonth,
        toMonth: e.toMonth,
        feeCents: e.feeOverrideCents ?? e.classFeeCents,
        feeOverrideCents: e.feeOverrideCents,
        reason: e.reason,
      })),
      devices: deviceRows.map((d) => ({
        id: d.id,
        label: d.label,
        firstSeenAt: d.firstSeenAt.toISOString(),
        lastSeenAt: d.lastSeenAt.toISOString(),
      })),
      // Phases 3–5 fill these in; the UI shows "—" for null.
      overview: {
        owesCents: null,
        paidThisYearCents: null,
        attendancePercent: null,
        lessonsWatched: null,
      },
      archivedAt: row.archivedAt?.toISOString() ?? null,
    };
  }

  // ----- STU-03 create -----------------------------------------------------------------------

  async create(tenantId: string, session: AuthSession, body: CreateBody): Promise<StudentProfile> {
    const now = this.clock.now();
    const month = body.enrolFrom ?? monthStart(now);
    const profile = await withTenant(this.db, tenantId, async (tx) => {
      await this.assertPhoneFree(tx, body.phone);
      await this.assertClassesUsable(tx, body.classIds, 'classIds');
      assertGuardians(body.guardians);

      const [tenant] = await tx
        .select({ prefix: tenants.studentNoPrefix })
        .from(tenants)
        .where(eq(tenants.id, tenantId));
      if (!tenant) throw new Error('tenant row missing inside its own context');

      // Allocate last-but-inserts: the counter row lock is held until commit.
      const block = await allocateNumbers(tx, 'student');
      let userId: string;
      try {
        const [user] = await tx
          .insert(tenantUsers)
          .values({
            tenantId,
            kind: 'student',
            phone: body.phone,
            displayName: body.displayName,
            status: 'invited',
            passwordHash: null,
          })
          .returning({ id: tenantUsers.id });
        if (!user) throw new Error('student user not created');
        userId = user.id;
      } catch (error) {
        if (isUniqueViolation(error)) throw phoneTaken();
        throw error;
      }
      await tx.insert(students).values({
        tenantId,
        userId,
        studentNo: formatStudentNo(tenant.prefix, block.first),
        school: body.school || null,
        alYear: body.alYear ?? null,
        medium: body.medium ?? null,
        under18: body.under18,
        ...(body.consent
          ? {
              consentGivenBy: body.consent.givenBy,
              consentMethod: body.consent.method,
              consentRecordedAt: now,
              consentRecordedBy: session.userId,
            }
          : {}),
      });
      if (body.guardians.length > 0) {
        await tx.insert(guardians).values(
          body.guardians.map((g) => ({
            tenantId,
            studentId: userId,
            name: g.name,
            relation: g.relation,
            phone: g.phone,
            smsOptIn: g.smsOptIn,
          })),
        );
      }
      if (body.classIds.length > 0) {
        await tx.insert(enrollments).values(
          body.classIds.map((classId) => ({
            tenantId,
            classId,
            studentId: userId,
            fromMonth: month,
          })),
        );
      }
      await this.audit.record(tx, tenantId, {
        ...actor(session, now),
        action: 'student.create',
        entity: 'student',
        entityId: userId,
        after: {
          studentNo: formatStudentNo(tenant.prefix, block.first),
          classes: body.classIds.length,
          guardians: body.guardians.length,
          under18: body.under18,
        },
      });
      return this.profile(tx, session, userId);
    });

    if (body.sendWelcomeSms) {
      // The hook enqueues the first-password SMS (AUTH-07).
      await this.hooks.onStudentInvited({
        tenantId,
        studentId: profile.id,
        displayName: profile.displayName,
        phone: profile.phone,
      });
    }
    return profile;
  }

  // ----- STU-05 update -----------------------------------------------------------------------

  update(
    tenantId: string,
    session: AuthSession,
    studentId: string,
    body: UpdateBody,
  ): Promise<StudentProfile> {
    const now = this.clock.now();
    return withTenant(this.db, tenantId, async (tx) => {
      const [current] = await tx
        .select({
          under18: students.under18,
          hasConsent: sql<boolean>`${students.consentMethod} is not null`,
          phone: tenantUsers.phone,
        })
        .from(students)
        .innerJoin(
          tenantUsers,
          and(eq(tenantUsers.tenantId, students.tenantId), eq(tenantUsers.id, students.userId)),
        )
        .where(eq(students.userId, studentId));
      if (!current) throw notFound();

      const under18 = body.under18 ?? current.under18;
      if (under18 && !current.hasConsent && !body.consent) {
        throw validation('consent', 'Record parental consent for students under 18');
      }
      if (body.guardians) assertGuardians(body.guardians);

      const userChanges: Partial<typeof tenantUsers.$inferInsert> = {};
      if (body.displayName !== undefined) userChanges.displayName = body.displayName;
      if (body.phone !== undefined && body.phone !== current.phone) {
        await this.assertPhoneFree(tx, body.phone, studentId);
        userChanges.phone = body.phone;
      }
      if (Object.keys(userChanges).length > 0) {
        try {
          await tx.update(tenantUsers).set(userChanges).where(eq(tenantUsers.id, studentId));
        } catch (error) {
          if (isUniqueViolation(error)) throw phoneTaken();
          throw error;
        }
      }

      const profileChanges: Partial<typeof students.$inferInsert> = {};
      if (body.school !== undefined) profileChanges.school = body.school || null;
      if (body.alYear !== undefined) profileChanges.alYear = body.alYear;
      if (body.medium !== undefined) profileChanges.medium = body.medium;
      if (body.under18 !== undefined) profileChanges.under18 = body.under18;
      if (body.consent) {
        profileChanges.consentGivenBy = body.consent.givenBy;
        profileChanges.consentMethod = body.consent.method;
        profileChanges.consentRecordedAt = now;
        profileChanges.consentRecordedBy = session.userId;
      }
      if (Object.keys(profileChanges).length > 0) {
        await tx.update(students).set(profileChanges).where(eq(students.userId, studentId));
      }

      if (body.guardians) {
        await tx.delete(guardians).where(eq(guardians.studentId, studentId));
        if (body.guardians.length > 0) {
          await tx.insert(guardians).values(
            body.guardians.map((g) => ({
              tenantId,
              studentId,
              name: g.name,
              relation: g.relation,
              phone: g.phone,
              smsOptIn: g.smsOptIn,
            })),
          );
        }
      }

      // Field names only: values (phones, names) stay out of the audit trail.
      await this.audit.record(tx, tenantId, {
        ...actor(session, now),
        action: 'student.update',
        entity: 'student',
        entityId: studentId,
        after: { fields: Object.keys(body) },
      });
      return this.profile(tx, session, studentId);
    });
  }

  // ----- STU-02 / STU-07 bulk ----------------------------------------------------------------

  bulk(tenantId: string, session: AuthSession, body: BulkBody): Promise<BulkResult> {
    const now = this.clock.now();
    const ids = [...new Set(body.studentIds)];
    return withTenant(this.db, tenantId, async (tx) => {
      const found = await tx
        .select({ id: students.userId, archivedAt: students.archivedAt })
        .from(students)
        .where(inArray(students.userId, ids));
      const byId = new Map(found.map((s) => [s.id, s]));
      const skipped = ids.filter((id) => !byId.has(id));
      const present = found.map((s) => s.id);

      switch (body.action) {
        case 'archive': {
          const targets = found.filter((s) => !s.archivedAt).map((s) => s.id);
          if (targets.length > 0) {
            await tx
              .update(students)
              .set({ archivedAt: now })
              .where(inArray(students.userId, targets));
            // An archived student cannot sign in: end every session and device now (STU-07).
            await this.signOut(tx, targets, session.userId, now);
            await this.audit.recordMany(
              tx,
              tenantId,
              targets.map((id) => ({
                ...actor(session, now),
                action: 'student.archive' as const,
                entity: 'student',
                entityId: id,
              })),
            );
          }
          return result(targets, [...skipped, ...present.filter((id) => !targets.includes(id))]);
        }
        case 'reactivate': {
          const targets = found.filter((s) => s.archivedAt).map((s) => s.id);
          if (targets.length > 0) {
            await tx
              .update(students)
              .set({ archivedAt: null })
              .where(inArray(students.userId, targets));
            await this.audit.recordMany(
              tx,
              tenantId,
              targets.map((id) => ({
                ...actor(session, now),
                action: 'student.reactivate' as const,
                entity: 'student',
                entityId: id,
              })),
            );
          }
          return result(targets, [...skipped, ...present.filter((id) => !targets.includes(id))]);
        }
        case 'sign_out_devices': {
          if (!can(session.roles, 'students.devices')) throw new AppException('FORBIDDEN', 403);
          const affected = await this.signOut(tx, present, session.userId, now);
          if (affected.length > 0) {
            await this.audit.recordMany(
              tx,
              tenantId,
              affected.map((id) => ({
                ...actor(session, now),
                action: 'student.devices_sign_out' as const,
                entity: 'student',
                entityId: id,
              })),
            );
          }
          return result(affected, [...skipped, ...present.filter((id) => !affected.includes(id))]);
        }
        case 'move_class': {
          if (body.fromClassId === body.toClassId) {
            throw validation('toClassId', 'Choose a different class');
          }
          await this.assertClassesUsable(tx, [body.toClassId], 'toClassId');
          await this.assertClassesUsable(tx, [body.fromClassId], 'fromClassId', true);
          const moved = await this.moveClass(tx, tenantId, present, body);
          if (moved.length > 0) {
            await this.audit.recordMany(
              tx,
              tenantId,
              moved.map((id) => ({
                ...actor(session, now),
                action: 'student.move_class' as const,
                entity: 'student',
                entityId: id,
                after: {
                  fromClassId: body.fromClassId,
                  toClassId: body.toClassId,
                  fromMonth: body.fromMonth,
                },
              })),
            );
          }
          return result(moved, [...skipped, ...present.filter((id) => !moved.includes(id))]);
        }
      }
    });
  }

  /** Signs devices out and revokes live sessions; returns the students that had either. */
  private async signOut(
    tx: Tx,
    studentIds: readonly string[],
    actorId: string,
    now: Date,
  ): Promise<string[]> {
    if (studentIds.length === 0) return [];
    const ids = [...studentIds];
    const deviceRows = await tx
      .update(devices)
      .set({ signedOutAt: now, signedOutBy: actorId })
      .where(and(inArray(devices.userId, ids), isNull(devices.signedOutAt)))
      .returning({ userId: devices.userId });
    const sessionRows = await tx
      .update(sessions)
      .set({ revokedAt: now, revokedReason: STAFF_SIGN_OUT })
      .where(and(inArray(sessions.userId, ids), isNull(sessions.revokedAt)))
      .returning({ userId: sessions.userId });
    return [...new Set([...deviceRows, ...sessionRows].map((r) => r.userId))];
  }

  /**
   * Ends the enrolment in `fromClassId` the month before `fromMonth` (or re-points it when it
   * started that very month) and starts the same terms — fee override included — in `toClassId`.
   * Students not enrolled in the source class that month, or already in the target, are skipped.
   */
  private async moveClass(
    tx: Tx,
    tenantId: string,
    studentIds: readonly string[],
    body: Extract<BulkBody, { action: 'move_class' }>,
  ): Promise<string[]> {
    if (studentIds.length === 0) return [];
    const ids = [...studentIds];
    const covering = (classId: string) =>
      and(
        eq(enrollments.classId, classId),
        inArray(enrollments.studentId, ids),
        sql`${enrollments.fromMonth} <= ${body.fromMonth}`,
        sql`(${enrollments.toMonth} is null or ${enrollments.toMonth} >= ${body.fromMonth})`,
      );
    const source = await tx.select().from(enrollments).where(covering(body.fromClassId));
    const already = await tx
      .select({ studentId: enrollments.studentId })
      .from(enrollments)
      .where(covering(body.toClassId));
    const taken = new Set(already.map((a) => a.studentId));
    const moving = source.filter((e) => !taken.has(e.studentId));
    const previousMonth = monthBefore(body.fromMonth);

    for (const e of moving) {
      if (e.fromMonth === body.fromMonth) {
        await tx
          .update(enrollments)
          .set({ classId: body.toClassId })
          .where(eq(enrollments.id, e.id));
      } else {
        await tx
          .update(enrollments)
          .set({ toMonth: previousMonth })
          .where(eq(enrollments.id, e.id));
        await tx.insert(enrollments).values({
          tenantId,
          classId: body.toClassId,
          studentId: e.studentId,
          fromMonth: body.fromMonth,
          toMonth: e.toMonth,
          feeOverrideCents: e.feeOverrideCents,
          reason: e.reason,
        });
      }
    }
    return [...new Set(moving.map((e) => e.studentId))];
  }

  // ----- shared checks -----------------------------------------------------------------------

  private async assertPhoneFree(tx: Tx, phone: string, exceptUserId?: string): Promise<void> {
    const [taken] = await tx
      .select({ id: tenantUsers.id })
      .from(tenantUsers)
      .where(
        and(
          eq(tenantUsers.phone, phone),
          exceptUserId ? ne(tenantUsers.id, exceptUserId) : undefined,
        ),
      );
    if (taken) throw phoneTaken();
  }

  private async assertClassesUsable(
    tx: Tx,
    classIds: readonly string[],
    path: string,
    allowArchived = false,
  ): Promise<void> {
    if (classIds.length === 0) return;
    const unique = [...new Set(classIds)];
    const rows = await tx
      .select({ id: classes.id, archivedAt: classes.archivedAt })
      .from(classes)
      .where(inArray(classes.id, unique));
    if (rows.length !== unique.length) throw validation(path, 'Choose an existing class');
    if (!allowArchived && rows.some((r) => r.archivedAt)) {
      throw validation(path, 'Archived classes cannot take new students');
    }
  }
}

/** Never matches a row; keeps `IN ()` valid for an empty teacher scope. */
const NO_ID = '00000000-0000-0000-0000-000000000000';

const phoneTaken = () =>
  new AppException('CONFLICT', 409, 'This phone number is already used at your institute');

function assertGuardians(list: GuardianBody): void {
  const seen = new Set<string>();
  for (const [i, g] of list.entries()) {
    if (seen.has(g.phone))
      throw validation(`guardians.${i}.phone`, 'Each guardian needs a different phone number');
    seen.add(g.phone);
  }
}

const actor = (
  session: AuthSession,
  at: Date,
): Pick<AuditEntry, 'actorId' | 'actorKind' | 'at'> => ({
  actorId: session.userId,
  actorKind: 'staff',
  at,
});

const result = (affected: readonly string[], skipped: readonly string[]): BulkResult => ({
  affected: affected.length,
  skipped: [...skipped],
});

/** `2026-11-01` → `2026-10-01` (months are stored as the first day of the month). */
export function monthBefore(month: string): string {
  const [year = 0, mon = 1] = month.split('-').map(Number);
  const date = new Date(Date.UTC(year, mon - 2, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-01`;
}
