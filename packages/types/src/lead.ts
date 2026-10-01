import { z } from 'zod';
import { sriLankaMobile } from './phone';

/**
 * Length limits for the demo / trial form. The form uses these for `maxLength`, the schema
 * enforces them, and the D1 table (apps/site/migrations) mirrors the upper bounds.
 */
export const LEAD_LIMITS = {
  name: 80,
  institute: 120,
  city: 60,
  message: 1000,
  studentsMax: 100_000,
  turnstileToken: 2048,
} as const;

/**
 * Control characters (Cc) and bidi override/isolate marks are never valid in a name or city —
 * they break email subjects and can disguise text in the admin UI. Zero-width joiners (Cf) are
 * allowed on purpose: Sinhala conjuncts need them.
 */
const SINGLE_LINE = /^[^\p{Cc}‪-‮⁦-⁩]*$/u;
/** Same, but free-text messages may contain newlines and tabs. */
const MULTI_LINE = /^(?:[^\p{Cc}‪-‮⁦-⁩]|[\n\r\t])*$/u;

const singleLine = (min: number, max: number) =>
  z
    .string()
    .trim()
    .min(min)
    .max(max)
    .regex(SINGLE_LINE)
    .transform((v) => v.normalize('NFC'));

/** Whole number of students. Accepts a number or a digit-only string (form inputs are strings). */
const studentCount = z
  .union([
    z.number(),
    z
      .string()
      .trim()
      .regex(/^\d{1,6}$/)
      .transform(Number),
  ])
  .pipe(z.number().int().min(1).max(LEAD_LIMITS.studentsMax));

/** Demo / free-trial request from remix.lk. Shared by the form and the Pages Function. */
export const leadSchema = z.strictObject({
  name: singleLine(2, LEAD_LIMITS.name),
  phone: sriLankaMobile,
  whatsappSame: z.boolean().default(true),
  institute: singleLine(2, LEAD_LIMITS.institute),
  students: studentCount,
  city: singleLine(2, LEAD_LIMITS.city),
  message: z
    .string()
    .trim()
    .max(LEAD_LIMITS.message)
    .regex(MULTI_LINE)
    .optional()
    .transform((v) => (v ? v.normalize('NFC') : undefined)),
  intent: z.enum(['demo', 'trial']).default('demo'),
});

/**
 * What the browser POSTs to /api/lead: the lead plus the Cloudflare Turnstile token.
 * Kept separate so the stored `Lead` type never carries the token.
 */
export const leadRequestSchema = z.strictObject({
  ...leadSchema.shape,
  turnstileToken: z.string().min(1).max(LEAD_LIMITS.turnstileToken),
});

export type LeadIntent = z.infer<typeof leadSchema>['intent'];
/** Validated, normalised lead (what gets stored). */
export type Lead = z.output<typeof leadSchema>;
/** Raw form values before validation. */
export type LeadInput = z.input<typeof leadSchema>;
export type LeadRequest = z.input<typeof leadRequestSchema>;
export type LeadField = keyof LeadInput;
