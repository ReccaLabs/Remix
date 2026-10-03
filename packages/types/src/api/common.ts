import { z } from 'zod';

/** A UUID path param, e.g. `/admin/students/:id`. */
export const idParamsSchema = z.strictObject({ id: z.uuid() });
export type IdParams = z.infer<typeof idParamsSchema>;

export const PAGE_SIZES = [25, 50, 100] as const;

/** Query values arrive as strings, so numbers are coerced. */
export const pageQuerySchema = z.strictObject({
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce
    .number()
    .int()
    .refine((n) => (PAGE_SIZES as readonly number[]).includes(n), 'Unsupported page size')
    .default(25),
});

export const pageMetaSchema = z.object({
  page: z.number().int().min(1),
  pageSize: z.number().int().min(1),
  total: z.number().int().nonnegative(),
});
export type PageMeta = z.infer<typeof pageMetaSchema>;

/** First day of a month, `YYYY-MM-01` (enrolment months, ADR 0007). */
export const monthSchema = z
  .string()
  .regex(/^\d{4}-(?:0[1-9]|1[0-2])-01$/, 'Use the first day of a month');

/** Calendar date `YYYY-MM-DD` in Asia/Colombo. */
export const dateSchema = z.iso.date();

export const isoDateTime = z.iso.datetime({ offset: true });

/** Trimmed human name (students, guardians, staff, classes). */
export const personName = z.string().trim().min(1).max(120);
