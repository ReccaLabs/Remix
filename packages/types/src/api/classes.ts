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
