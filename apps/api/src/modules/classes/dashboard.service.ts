import { Inject, Injectable } from '@nestjs/common';
import { and, count, eq, isNull, sql, type SQL } from 'drizzle-orm';
import { schema, withTenant, type Db } from '@remix/db';
import type { API } from '@remix/types/api';
import type { AuthSession } from '../../common/auth/session-authenticator';
import { monthStart } from '../../common/time/business-date';
import { CLOCK, type Clock } from '../../common/time/clock';
import type { EndpointResult } from '../../common/validation/endpoint';
import { DB } from '../db/db.module';
import { visibleClassIds } from '../people/scope';
import { inIds } from './class-support';
import { TimetableService } from './timetable.service';

const { classes, enrollments, students, tenantUsers } = schema;

/**
 * Admin dashboard skeleton: real counts and "Today's classes" from the timetable. Money and
 * attendance tiles stay out until Phases 3/5. A class-scoped teacher (STF-02) only counts their
 * own classes and the students in them, and sees no staff count.
 */
@Injectable()
export class DashboardService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly timetable: TimetableService,
  ) {}

  get(tenantId: string, session: AuthSession): Promise<EndpointResult<typeof API.dashboard>> {
    const month = monthStart(this.clock.now());
    return withTenant(this.db, tenantId, async (tx) => {
      const scope = await visibleClassIds(tx, session);

      // Students with a current enrolment in one of the teacher's classes, or all students.
      const inScope: SQL | undefined = scope
        ? sql`exists (select 1 from ${enrollments} e where e.tenant_id = ${students.tenantId}
            and e.student_id = ${students.userId} and e.class_id in (${sql.join(
              (scope.length > 0 ? scope : ['00000000-0000-0000-0000-000000000000']).map(
                (id) => sql`${id}::uuid`,
              ),
              sql`, `,
            )}) and e.from_month <= ${month} and (e.to_month is null or e.to_month >= ${month}))`
        : undefined;
      const studentCount = async (extra: SQL | undefined) => {
        const [row] = await tx
          .select({ n: count() })
          .from(students)
          .innerJoin(
            tenantUsers,
            and(eq(tenantUsers.tenantId, students.tenantId), eq(tenantUsers.id, students.userId)),
          )
          .where(and(isNull(students.archivedAt), inScope, extra));
        return row?.n ?? 0;
      };

      const activeStudents = await studentCount(sql`${tenantUsers.status} <> 'invited'`);
      const invitedStudents = await studentCount(eq(tenantUsers.status, 'invited'));
      const newStudentsThisMonth = await studentCount(
        sql`(${tenantUsers.createdAt} at time zone 'Asia/Colombo')::date >= ${month}::date`,
      );
      const [classRow] = await tx
        .select({ n: count() })
        .from(classes)
        .where(and(isNull(classes.archivedAt), scope ? inIds(classes.id, scope) : undefined));
      const [staffRow] = scope
        ? [{ n: 0 }]
        : await tx
            .select({ n: count() })
            .from(tenantUsers)
            .where(and(eq(tenantUsers.kind, 'staff'), eq(tenantUsers.status, 'active')));

      return {
        counts: {
          activeStudents,
          invitedStudents,
          classes: classRow?.n ?? 0,
          staff: staffRow?.n ?? 0,
          newStudentsThisMonth,
        },
        todaysClasses: await this.timetable.todaysSlots(tx, scope),
      };
    });
  }
}
