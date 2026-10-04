import { z } from 'zod';

/**
 * Stable machine-readable error codes. Clients branch on `code`, never on `title` or `status`.
 * Adding a code is a non-breaking change; renaming or removing one is breaking (v2).
 */
export const ERROR_CODES = [
  'VALIDATION_FAILED',
  'UNAUTHENTICATED',
  'FORBIDDEN',
  'NOT_FOUND',
  'TENANT_NOT_FOUND',
  'TENANT_UNAVAILABLE',
  'INVALID_CREDENTIALS',
  'ACCOUNT_DISABLED',
  'DEVICE_LIMIT',
  'TWO_STEP_REQUIRED',
  'CODE_INVALID',
  'ACCOUNT_LOCKED',
  'PASSWORD_CHANGE_REQUIRED',
  'INVITE_INVALID',
  'PLAN_LIMIT',
  'INSUFFICIENT_BALANCE',
  'ALREADY_PAID',
  'PAYMENT_PROVIDER_UNAVAILABLE',
  'RATE_LIMITED',
  'CSRF_REJECTED',
  'CONFLICT',
  'INTERNAL',
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

/**
 * RFC 9457 `application/problem+json` body returned by every API error.
 * Parsed leniently (`z.object`) so new optional members don't break older clients.
 * Never contains stack traces, SQL or secrets.
 */
export const problemSchema = z.object({
  type: z.string(),
  title: z.string(),
  status: z.number().int().min(400).max(599),
  code: z.enum(ERROR_CODES),
  detail: z.string().optional(),
  /** Field-level validation errors (`path` is dot-joined, e.g. `phone`). */
  errors: z.array(z.object({ path: z.string(), message: z.string() })).optional(),
  /** Correlates with server logs; safe to show to support staff. */
  requestId: z.string().optional(),
  /**
   * Follow-up step for `DEVICE_LIMIT` and `TWO_STEP_REQUIRED` (see `deviceLimitChallengeSchema`,
   * `twoStepChallengeSchema` in ./auth). Kept `unknown` here; the caller parses it by `code`.
   */
  challenge: z.unknown().optional(),
});
export type Problem = z.infer<typeof problemSchema>;

export const PROBLEM_CONTENT_TYPE = 'application/problem+json';
