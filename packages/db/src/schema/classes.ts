import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  date,
  foreignKey,
  index,
  pgTable,
  smallint,
  text,
  time,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { id, instant, tenantId, timestamps } from './columns';
import { classPlace, medium } from './enums';
import { tenants } from './tenants';
import { students, tenantUsers } from './users';

/** A class an institute runs, e.g. "2027 A/L Physics Theory". `fee_cents` is the monthly fee. */
export const classes = pgTable(
  'classes',
  {
    id: id(),
    tenantId: tenantId().references(() => tenants.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    grade: text('grade').notNull(),
    medium: medium('medium').notNull(),
    teacherId: uuid('teacher_id'),
    feeCents: bigint('fee_cents', { mode: 'number' }).notNull(),
    place: classPlace('place').notNull(),
    startsOn: date('starts_on', { mode: 'string' }),
    archivedAt: instant('archived_at'),
    ...timestamps(),
  },
  (t) => [
    foreignKey({
      name: 'classes_teacher_fk',
      columns: [t.tenantId, t.teacherId],
      foreignColumns: [tenantUsers.tenantId, tenantUsers.id],
    }),
    unique('classes_tenant_id_id_key').on(t.tenantId, t.id),
    index('classes_tenant_teacher_idx').on(t.tenantId, t.teacherId),
    check('classes_name_length', sql`char_length(${t.name}) BETWEEN 1 AND 120`),
    check('classes_grade_length', sql`char_length(${t.grade}) BETWEEN 1 AND 40`),
    check('classes_fee_non_negative', sql`${t.feeCents} >= 0`),
  ],
);

/** Weekly slot. `weekday` is ISO (1 = Monday … 7 = Sunday); `start_time` is Asia/Colombo wall-clock. */
export const classSchedules = pgTable(
  'class_schedules',
  {
    id: id(),
    tenantId: tenantId().references(() => tenants.id, { onDelete: 'cascade' }),
    classId: uuid('class_id').notNull(),
    weekday: smallint('weekday').notNull(),
    startTime: time('start_time').notNull(),
    durationMinutes: smallint('duration_minutes').notNull(),
    ...timestamps(),
  },
  (t) => [
    foreignKey({
      name: 'class_schedules_class_fk',
      columns: [t.tenantId, t.classId],
      foreignColumns: [classes.tenantId, classes.id],
    }).onDelete('cascade'),
    unique('class_schedules_tenant_id_id_key').on(t.tenantId, t.id),
    index('class_schedules_tenant_class_idx').on(t.tenantId, t.classId),
    check('class_schedules_weekday_iso', sql`${t.weekday} BETWEEN 1 AND 7`),
    check('class_schedules_duration_range', sql`${t.durationMinutes} BETWEEN 15 AND 600`),
  ],
);

/**
 * A student's membership of a class for a range of months (`to_month` null = ongoing). Months
 * are stored as the first day of the month. `fee_override_cents` replaces the class fee.
 */
export const enrollments = pgTable(
  'enrollments',
  {
    id: id(),
    tenantId: tenantId().references(() => tenants.id, { onDelete: 'cascade' }),
    classId: uuid('class_id').notNull(),
    studentId: uuid('student_id').notNull(),
    fromMonth: date('from_month', { mode: 'string' }).notNull(),
    toMonth: date('to_month', { mode: 'string' }),
    feeOverrideCents: bigint('fee_override_cents', { mode: 'number' }),
    reason: text('reason'),
    ...timestamps(),
  },
  (t) => [
    foreignKey({
      name: 'enrollments_class_fk',
      columns: [t.tenantId, t.classId],
      foreignColumns: [classes.tenantId, classes.id],
    }),
    foreignKey({
      name: 'enrollments_student_fk',
      columns: [t.tenantId, t.studentId],
      foreignColumns: [students.tenantId, students.userId],
    }),
    unique('enrollments_tenant_id_id_key').on(t.tenantId, t.id),
    index('enrollments_tenant_class_idx').on(t.tenantId, t.classId),
    index('enrollments_tenant_student_idx').on(t.tenantId, t.studentId),
    check('enrollments_from_month_first_day', sql`extract(day from ${t.fromMonth}) = 1`),
    check('enrollments_to_month_first_day', sql`extract(day from ${t.toMonth}) = 1`),
    check('enrollments_month_order', sql`${t.toMonth} >= ${t.fromMonth}`),
    check('enrollments_fee_override_non_negative', sql`${t.feeOverrideCents} >= 0`),
    check(
      'enrollments_fee_override_has_reason',
      sql`${t.feeOverrideCents} IS NULL OR ${t.reason} IS NOT NULL`,
    ),
  ],
);
