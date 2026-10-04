import { z } from 'zod';

export const MEDIUMS = ['sinhala', 'tamil', 'english'] as const;
export type Medium = (typeof MEDIUMS)[number];

export const CLASS_PLACES = ['hall', 'online', 'hybrid'] as const;
export type ClassPlace = (typeof CLASS_PLACES)[number];

/** One weekly slot. `weekday` is ISO (1 = Monday … 7 = Sunday); times are Asia/Colombo wall-clock. */
export const classScheduleSchema = z.object({
  weekday: z.number().int().min(1).max(7),
  startTime: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/),
  durationMinutes: z.number().int().min(15).max(600),
});
export type ClassSchedule = z.infer<typeof classScheduleSchema>;

/** A class as a student sees it in their list (GET /api/v1/me/classes). */
export const classSummarySchema = z.object({
  id: z.uuid(),
  name: z.string(),
  grade: z.string(),
  medium: z.enum(MEDIUMS),
  teacherName: z.string().nullable(),
  /** Monthly fee in cents (after any per-student override). */
  feeCents: z.number().int().nonnegative(),
  place: z.enum(CLASS_PLACES),
  schedule: z.array(classScheduleSchema),
});
export type ClassSummary = z.infer<typeof classSummarySchema>;

export const myClassesResponseSchema = z.object({ items: z.array(classSummarySchema) });
export type MyClassesResponse = z.infer<typeof myClassesResponseSchema>;

// ---------------------------------------------------------------------------------------------
// Phase 2 — admin classes, halls, enrolments, timetable (CLS-01..06)
// ---------------------------------------------------------------------------------------------

/** CLS-05 — a room the institute teaches in. */
export const hallInputSchema = z.strictObject({
  name: z.string().trim().min(1).max(60),
  capacity: z.number().int().min(1).max(5000).nullable().default(null),
});
export type HallInput = z.input<typeof hallInputSchema>;

export const hallSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  capacity: z.number().int().nullable(),
});
export type Hall = z.infer<typeof hallSchema>;

export const hallsResponseSchema = z.object({ items: z.array(hallSchema) });

const monthStart = z.string().regex(/^\d{4}-(?:0[1-9]|1[0-2])-01$/, 'Use the first day of a month');

/** CLS-02 — create/edit a class. `feeCents` is the monthly fee (integer cents). */
export const classInputSchema = z
  .strictObject({
    name: z.string().trim().min(1).max(120),
    grade: z.string().trim().min(1).max(40),
    medium: z.enum(MEDIUMS),
    teacherId: z.uuid().nullable().default(null),
    feeCents: z.number().int().min(0).max(100_000_000),
    place: z.enum(CLASS_PLACES),
    hallId: z.uuid().nullable().default(null),
    startsOn: z.iso.date().nullable().default(null),
    schedule: z.array(classScheduleSchema).max(14).default([]),
  })
  .refine((c) => c.place !== 'online' || c.hallId === null, {
    message: 'Online classes have no hall',
    path: ['hallId'],
  });
export type ClassInput = z.input<typeof classInputSchema>;

export const updateClassSchema = z
  .strictObject({
    name: z.string().trim().min(1).max(120).optional(),
    grade: z.string().trim().min(1).max(40).optional(),
    medium: z.enum(MEDIUMS).optional(),
    teacherId: z.uuid().nullable().optional(),
    feeCents: z.number().int().min(0).max(100_000_000).optional(),
    place: z.enum(CLASS_PLACES).optional(),
    hallId: z.uuid().nullable().optional(),
    startsOn: z.iso.date().nullable().optional(),
    /** Replaces all weekly slots when present. */
    schedule: z.array(classScheduleSchema).max(14).optional(),
  })
  .refine((c) => Object.keys(c).length > 0, 'Nothing to update');
export type UpdateClassRequest = z.input<typeof updateClassSchema>;

/** CLS-01 filters. Teachers only ever see their own classes (STF-02). */
export const listClassesQuerySchema = z.strictObject({
  q: z.string().trim().max(80).optional(),
  grade: z.string().trim().max(40).optional(),
  place: z.enum(CLASS_PLACES).optional(),
  teacherId: z.uuid().optional(),
  archived: z.enum(['true', 'false']).default('false'),
});
export type ListClassesQuery = z.input<typeof listClassesQuerySchema>;

export const adminClassSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  grade: z.string(),
  medium: z.enum(MEDIUMS),
  teacherId: z.uuid().nullable(),
  teacherName: z.string().nullable(),
  feeCents: z.number().int().nonnegative(),
  place: z.enum(CLASS_PLACES),
  hallId: z.uuid().nullable(),
  hallName: z.string().nullable(),
  startsOn: z.iso.date().nullable(),
  schedule: z.array(classScheduleSchema),
  /** Students with an enrolment covering the current month. */
  studentCount: z.number().int().nonnegative(),
  /** Paid share of this month's fees; null until fees exist (Phase 3). */
  paidPercent: z.number().min(0).max(100).nullable(),
  archivedAt: z.iso.datetime({ offset: true }).nullable(),
});
export type AdminClass = z.infer<typeof adminClassSchema>;

export const listClassesResponseSchema = z.object({ items: z.array(adminClassSchema) });

/** CLS-03 — detail header KPIs. Fee and attendance figures are null until Phases 3/5. */
export const classDetailSchema = adminClassSchema.extend({
  kpis: z.object({
    enrolled: z.number().int().nonnegative(),
    paid: z.number().int().nonnegative().nullable(),
    unpaid: z.number().int().nonnegative().nullable(),
    avgAttendancePercent: z.number().min(0).max(100).nullable(),
  }),
});
export type ClassDetail = z.infer<typeof classDetailSchema>;

export const classStudentSchema = z.object({
  enrollmentId: z.uuid(),
  studentId: z.uuid(),
  studentNo: z.string(),
  displayName: z.string(),
  phone: z.string(),
  fromMonth: monthStart,
  toMonth: monthStart.nullable(),
  feeCents: z.number().int().nonnegative(),
  feeOverrideCents: z.number().int().nonnegative().nullable(),
  reason: z.string().nullable(),
});
export type ClassStudent = z.infer<typeof classStudentSchema>;

export const classStudentsResponseSchema = z.object({ items: z.array(classStudentSchema) });

const feeOverride = {
  /** 0 = free card. Requires a reason (audited). */
  feeOverrideCents: z.number().int().min(0).max(100_000_000).nullable().default(null),
  reason: z.string().trim().min(1).max(200).nullable().default(null),
};
const overrideRule = (e: { feeOverrideCents?: number | null; reason?: string | null }) =>
  e.feeOverrideCents == null || !!e.reason;
const overrideIssue = { message: 'Give a reason for the fee change', path: ['reason'] };

/** CLS-04 — enrol one or more students from a month. Already-enrolled students are skipped. */
export const enrolStudentsSchema = z
  .strictObject({
    studentIds: z.array(z.uuid()).min(1).max(500),
    fromMonth: monthStart,
    ...feeOverride,
  })
  .refine(overrideRule, overrideIssue);
export type EnrolStudentsRequest = z.input<typeof enrolStudentsSchema>;

export const enrolStudentsResponseSchema = z.object({
  enrolled: z.number().int().nonnegative(),
  skipped: z.array(z.uuid()),
});

/** CLS-04 — change the fee override or end the enrolment (`toMonth` = last month attended). */
export const updateEnrollmentSchema = z
  .strictObject({
    feeOverrideCents: z.number().int().min(0).max(100_000_000).nullable().optional(),
    reason: z.string().trim().min(1).max(200).nullable().optional(),
    toMonth: monthStart.nullable().optional(),
  })
  .refine((e) => Object.keys(e).length > 0, 'Nothing to update')
  .refine(overrideRule, overrideIssue);
export type UpdateEnrollmentRequest = z.input<typeof updateEnrollmentSchema>;

/** CLS-04 — move: ends the current enrolment the month before `fromMonth`, opens a new one. */
export const moveEnrollmentSchema = z.strictObject({
  toClassId: z.uuid(),
  fromMonth: monthStart,
});
export type MoveEnrollmentRequest = z.input<typeof moveEnrollmentSchema>;

/** CLS-06 — one occurrence on a given date (Asia/Colombo). */
export const timetableSlotSchema = z.object({
  classId: z.uuid(),
  className: z.string(),
  grade: z.string(),
  teacherName: z.string().nullable(),
  hallName: z.string().nullable(),
  place: z.enum(CLASS_PLACES),
  date: z.iso.date(),
  startTime: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/),
  durationMinutes: z.number().int(),
  studentCount: z.number().int().nonnegative(),
});
export type TimetableSlot = z.infer<typeof timetableSlotSchema>;

/** `weekStart` must be a Monday; defaults to the current week. */
export const timetableQuerySchema = z.strictObject({ weekStart: z.iso.date().optional() });

export const timetableResponseSchema = z.object({
  weekStart: z.iso.date(),
  slots: z.array(timetableSlotSchema),
});
export type TimetableResponse = z.infer<typeof timetableResponseSchema>;

/** Public timetable on the institute website: no student counts. */
export const publicTimetableResponseSchema = z.object({
  weekStart: z.iso.date(),
  slots: z.array(timetableSlotSchema.omit({ studentCount: true })),
});

/** CLS-02: the teacher picker exposes only active teacher IDs and display names. */
export const teachersResponseSchema = z.strictObject({
  items: z.array(z.strictObject({ id: z.uuid(), displayName: z.string() })),
});
