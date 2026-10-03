import { z } from 'zod';
import { sriLankaMobile } from '../phone';
import { deviceSchema } from './auth';
import { MEDIUMS } from './classes';
import {
  dateSchema,
  isoDateTime,
  monthSchema,
  pageMetaSchema,
  pageQuerySchema,
  personName,
} from './common';

export const GUARDIAN_RELATIONS = ['mother', 'father', 'guardian', 'other'] as const;
export type GuardianRelation = (typeof GUARDIAN_RELATIONS)[number];

/** PAR-01 — a parent or guardian. `smsOptIn` = receives fee and attendance SMS (Phase 3/5). */
export const guardianInputSchema = z.strictObject({
  name: personName,
  relation: z.enum(GUARDIAN_RELATIONS),
  phone: sriLankaMobile,
  smsOptIn: z.boolean().default(true),
});
export type GuardianInput = z.input<typeof guardianInputSchema>;

export const guardianSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  relation: z.enum(GUARDIAN_RELATIONS),
  phone: z.string(),
  smsOptIn: z.boolean(),
});
export type Guardian = z.infer<typeof guardianSchema>;

export const CONSENT_METHODS = ['paper_form', 'verbal', 'online'] as const;

/**
 * PAR-03 — parental consent for a student under 18 (PDPA). Required when `under18` is true;
 * recorded once with who gave it and how.
 */
export const consentInputSchema = z.strictObject({
  givenBy: personName,
  method: z.enum(CONSENT_METHODS),
});

export const consentSchema = z.object({
  givenBy: z.string(),
  method: z.enum(CONSENT_METHODS),
  recordedAt: isoDateTime,
});

const alYear = z.number().int().min(2000).max(2100);
const optionalText = (max: number) => z.string().trim().max(max).optional();

const studentFields = {
  displayName: personName,
  phone: sriLankaMobile,
  school: optionalText(120),
  alYear: alYear.optional(),
  medium: z.enum(MEDIUMS).optional(),
  under18: z.boolean().default(false),
  consent: consentInputSchema.optional(),
  guardians: z.array(guardianInputSchema).max(3).default([]),
};

const consentRule = (s: { under18?: boolean; consent?: unknown }) => !s.under18 || !!s.consent;
const consentIssue = {
  message: 'Record parental consent for students under 18',
  path: ['consent'],
};

/**
 * STU-03 — add a student. The student number is allocated by the server (TEN-02). The account
 * starts `invited`: the student sets a password with an SMS code on first login (AUTH-07).
 */
export const createStudentSchema = z
  .strictObject({
    ...studentFields,
    /** Classes to enrol in, from `enrolFrom` (defaults to the current month). */
    classIds: z.array(z.uuid()).max(20).default([]),
    enrolFrom: monthSchema.optional(),
    /** Send the first-password SMS now (AUTH-07). */
    sendWelcomeSms: z.boolean().default(true),
  })
  .refine(consentRule, consentIssue);
export type CreateStudentRequest = z.input<typeof createStudentSchema>;

/** Partial update; `guardians` replaces the whole list when present. */
export const updateStudentSchema = z
  .strictObject({
    displayName: studentFields.displayName.optional(),
    phone: studentFields.phone.optional(),
    school: studentFields.school.nullable(),
    alYear: alYear.nullable().optional(),
    medium: z.enum(MEDIUMS).nullable().optional(),
    under18: z.boolean().optional(),
    consent: consentInputSchema.optional(),
    guardians: z.array(guardianInputSchema).max(3).optional(),
  })
  .refine((s) => Object.keys(s).length > 0, 'Nothing to update');
export type UpdateStudentRequest = z.input<typeof updateStudentSchema>;

export const STUDENT_STATUSES = ['active', 'invited', 'archived'] as const;
export type StudentStatus = (typeof STUDENT_STATUSES)[number];

/** STU-01 — list filters. `classId` limited to the teacher's classes for teachers (STF-02). */
export const listStudentsQuerySchema = pageQuerySchema.extend({
  q: z.string().trim().max(80).optional(),
  classId: z.uuid().optional(),
  status: z.enum(STUDENT_STATUSES).optional(),
  /** Students currently signed in on this many devices or more. */
  minDevices: z.coerce.number().int().min(0).max(2).optional(),
  joinedFrom: dateSchema.optional(),
  joinedTo: dateSchema.optional(),
  sort: z.enum(['name', 'studentNo', 'joined']).default('name'),
});
export type ListStudentsQuery = z.input<typeof listStudentsQuerySchema>;

export const studentListItemSchema = z.object({
  id: z.uuid(),
  studentNo: z.string(),
  displayName: z.string(),
  phone: z.string(),
  school: z.string().nullable(),
  alYear: z.number().int().nullable(),
  status: z.enum(STUDENT_STATUSES),
  classNames: z.array(z.string()),
  activeDevices: z.number().int().nonnegative(),
  joinedAt: isoDateTime,
});
export type StudentListItem = z.infer<typeof studentListItemSchema>;

export const listStudentsResponseSchema = pageMetaSchema.extend({
  items: z.array(studentListItemSchema),
});
export type ListStudentsResponse = z.infer<typeof listStudentsResponseSchema>;

export const studentEnrollmentSchema = z.object({
  id: z.uuid(),
  classId: z.uuid(),
  className: z.string(),
  fromMonth: monthSchema,
  toMonth: monthSchema.nullable(),
  /** Effective monthly fee (override or class fee). */
  feeCents: z.number().int().nonnegative(),
  feeOverrideCents: z.number().int().nonnegative().nullable(),
  reason: z.string().nullable(),
});
export type StudentEnrollment = z.infer<typeof studentEnrollmentSchema>;

/**
 * STU-05 — profile. Money/attendance/lesson figures arrive with Phases 3–5; until then they are
 * null and the UI shows "—".
 */
export const studentProfileSchema = studentListItemSchema.extend({
  medium: z.enum(MEDIUMS).nullable(),
  under18: z.boolean(),
  consent: consentSchema.nullable(),
  guardians: z.array(guardianSchema),
  enrollments: z.array(studentEnrollmentSchema),
  devices: z.array(deviceSchema.omit({ current: true })),
  overview: z.object({
    owesCents: z.number().int().nonnegative().nullable(),
    paidThisYearCents: z.number().int().nonnegative().nullable(),
    attendancePercent: z.number().min(0).max(100).nullable(),
    lessonsWatched: z.number().int().nonnegative().nullable(),
  }),
  archivedAt: isoDateTime.nullable(),
});
export type StudentProfile = z.infer<typeof studentProfileSchema>;

export const studentDeviceParamsSchema = z.strictObject({ id: z.uuid(), deviceId: z.uuid() });

/**
 * STU-02 — bulk actions available in Phase 2. "Send SMS" (Phase 6) and "Mark paid" (Phase 3)
 * join this union later.
 */
export const bulkStudentActionSchema = z.discriminatedUnion('action', [
  z.strictObject({
    action: z.literal('sign_out_devices'),
    studentIds: z.array(z.uuid()).min(1).max(500),
  }),
  z.strictObject({
    action: z.literal('move_class'),
    studentIds: z.array(z.uuid()).min(1).max(500),
    fromClassId: z.uuid(),
    toClassId: z.uuid(),
    fromMonth: monthSchema,
  }),
  z.strictObject({ action: z.literal('archive'), studentIds: z.array(z.uuid()).min(1).max(500) }),
  z.strictObject({
    action: z.literal('reactivate'),
    studentIds: z.array(z.uuid()).min(1).max(500),
  }),
]);
export type BulkStudentAction = z.input<typeof bulkStudentActionSchema>;

export const bulkResultSchema = z.object({
  affected: z.number().int().nonnegative(),
  /** Ids that were skipped (not found, not allowed, already in that state). */
  skipped: z.array(z.uuid()),
});
export type BulkResult = z.infer<typeof bulkResultSchema>;
