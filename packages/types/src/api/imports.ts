import { z } from 'zod';

/**
 * STU-04 / DAT-01 — student import. The browser parses the CSV/Excel file and applies the column
 * mapping; the server receives raw string cells, validates every row with the same rules as
 * "Add student", and answers with a preview. Commit re-validates — never trust the preview.
 */
export const IMPORT_FIELDS = [
  'displayName',
  'phone',
  'studentNo',
  'school',
  'alYear',
  'medium',
  'under18',
  'consentGivenBy',
  'guardianName',
  'guardianRelation',
  'guardianPhone',
  /** Class names separated by `;` — must match existing classes exactly (case-insensitive). */
  'classes',
] as const;
export type ImportField = (typeof IMPORT_FIELDS)[number];

export const REQUIRED_IMPORT_FIELDS = ['displayName', 'phone'] as const satisfies ImportField[];

export const IMPORT_MAX_ROWS = 5000;

const cell = z.string().max(500);

/** One mapped row: only known fields, all strings as they came out of the file. */
export const importRowSchema = z.strictObject(
  Object.fromEntries(IMPORT_FIELDS.map((f) => [f, cell.optional()])) as Record<
    ImportField,
    z.ZodOptional<typeof cell>
  >,
);
export type ImportRow = z.infer<typeof importRowSchema>;

export const studentImportSchema = z.strictObject({
  rows: z.array(importRowSchema).min(1).max(IMPORT_MAX_ROWS),
  /** Enrolment month for the `classes` column (defaults to the current month). */
  enrolFrom: z
    .string()
    .regex(/^\d{4}-(?:0[1-9]|1[0-2])-01$/)
    .optional(),
  /** Send first-password SMS to every created student (AUTH-07). */
  sendWelcomeSms: z.boolean().default(false),
});
export type StudentImportRequest = z.input<typeof studentImportSchema>;

export const IMPORT_ROW_STATUSES = ['ok', 'error', 'duplicate'] as const;

export const importRowResultSchema = z.object({
  /** 1-based, matching the spreadsheet row after the header. */
  rowNo: z.number().int().min(1),
  status: z.enum(IMPORT_ROW_STATUSES),
  errors: z.array(z.object({ field: z.string(), message: z.string() })),
  /** For duplicates: the existing student with that phone, or the earlier row in the file. */
  duplicateOf: z
    .object({ studentNo: z.string().nullable(), rowNo: z.number().int().nullable() })
    .nullable(),
});
export type ImportRowResult = z.infer<typeof importRowResultSchema>;

export const importSummarySchema = z.object({
  total: z.number().int(),
  ok: z.number().int(),
  errors: z.number().int(),
  duplicates: z.number().int(),
});

/** Dry run: nothing is written. */
export const importPreviewResponseSchema = z.object({
  summary: importSummarySchema,
  rows: z.array(importRowResultSchema),
});
export type ImportPreviewResponse = z.infer<typeof importPreviewResponseSchema>;

export const IMPORT_JOB_STATUSES = ['queued', 'running', 'done', 'failed'] as const;
export type ImportJobStatus = (typeof IMPORT_JOB_STATUSES)[number];

/**
 * Commit queues an import job on the `imports` queue (ADR 0012) and answers 202 with it. The job
 * re-validates every row, writes all `ok` rows in one transaction and skips the rest (errors and
 * duplicates are reported again so the error file can be downloaded). Audited as one event.
 * Poll `getImportJob` until `done` or `failed`; result fields are null until then.
 */
export const importJobSchema = z.object({
  id: z.uuid(),
  status: z.enum(IMPORT_JOB_STATUSES),
  createdAt: z.iso.datetime({ offset: true }),
  finishedAt: z.iso.datetime({ offset: true }).nullable(),
  summary: importSummarySchema.nullable(),
  created: z.number().int().nonnegative().nullable(),
  enrolled: z.number().int().nonnegative().nullable(),
  rows: z.array(importRowResultSchema).nullable(),
});
export type ImportJob = z.infer<typeof importJobSchema>;
