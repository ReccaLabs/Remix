import { z } from 'zod';

/**
 * Queue names, a closed list (ADR 0012). One queue per kind of work so a slow import cannot
 * starve SMS. Add `invoices` / `reminders` here when those phases land.
 */
export const QUEUES = ['sms', 'imports', 'fees', 'receipts', 'media'] as const;
export type QueueName = (typeof QUEUES)[number];

/** Valkey key prefix of every BullMQ key; keeps jobs apart from limiter/cache keys. */
/** The `sms` job id, the business key of one message (also used to find a job that exists). */
export function smsJobId(tenantId: string, messageId: string): string {
  return `sms-${tenantId}-${messageId}`;
}

export const JOBS_PREFIX = 'remix:jobs';

/** Ids that go into a job's business key: no `:` (BullMQ rejects it), no whitespace. */
const idPart = z
  .string()
  .min(1)
  .max(100)
  .regex(/^[A-Za-z0-9_-]+$/);

/** Every payload carries the tenant: the worker runs tenant work only through `withTenant()`. */
const tenantId = z.uuid();
export const receiptsPayload = z.strictObject({ tenantId, paymentId: z.uuid(), receiptId: z.uuid() });

/**
 * Payload schemas. `z.strictObject`, validated when a job is added and again in the worker.
 * No secrets here: ids and references only (ADR 0012), with the OTP text the one exception.
 */
export const smsPayload = z.strictObject({
  tenantId,
  /** Unique per message; with the tenant it forms the job id and the provider idempotency key. */
  messageId: idPart,
  gateway: z.enum(['remix-wallet', 'textlk', 'byo-http']),
  /** Approved sender mask. */
  senderId: z.string().min(1).max(11),
  /** Reference to the encrypted credentials row, never the credentials. */
  credentialsRef: z.string().min(1).max(100).optional(),
  /** Normalised Sri Lankan mobile. */
  to: z.string().regex(/^\+947\d{8}$/),
  text: z.string().min(1).max(1000),
  /**
   * The wallet was debited for this message (MSG-02): the worker marks it sent, or refunds it when
   * the send fails for good. Absent for OTP/invite SMS, which are platform cost.
   */
  billed: z.literal(true).optional(),
});

export const importsPayload = z.strictObject({
  tenantId,
  importId: idPart,
});

/** Scheduler ticks touch no tenant rows; only the narrow tenant-id discovery function. */
export const FEES_SYSTEM_TENANT = '00000000-0000-0000-0000-000000000000';
const feeMonth = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
const feeTenant = tenantId.refine(id => id !== FEES_SYSTEM_TENANT);
export const feesPayload = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('monthly_tick'), tenantId: z.literal(FEES_SYSTEM_TENANT) }),
  z.strictObject({ kind: z.literal('nightly_tick'), tenantId: z.literal(FEES_SYSTEM_TENANT) }),
  z.strictObject({ kind: z.literal('reminders_tick'), tenantId: z.literal(FEES_SYSTEM_TENANT) }),
  z.strictObject({ kind: z.literal('invoices'), tenantId: feeTenant, month: feeMonth }),
  z.strictObject({ kind: z.literal('recompute'), tenantId: feeTenant, date: z.iso.date() }),
  /** FEE-12: send the automatic fee reminders that fall due on `date` (Asia/Colombo). */
  z.strictObject({ kind: z.literal('reminders'), tenantId: feeTenant, date: z.iso.date() }),
]);
export function feesBusinessKey(p: z.output<typeof feesPayload>): string {
  if (p.kind === 'invoices') return `invoices:${p.tenantId}:${p.month}`;
  if (p.kind === 'recompute') return `fee-projections:${p.tenantId}:${p.date}`;
  if (p.kind === 'reminders') return `fee-reminders:${p.tenantId}:${p.date}`;
  return `fees:${p.kind}`;
}

/**
 * ADR 0009 media worker: re-encode one uploaded slip image, and the hourly clean-up of uploads
 * left unprocessed for 24 h (tick fans out one job per tenant, keyed by the Colombo hour).
 */
const mediaTenant = tenantId.refine((id) => id !== FEES_SYSTEM_TENANT);
export const mediaPayload = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('slip'), tenantId: mediaTenant, uploadId: z.uuid() }),
  z.strictObject({ kind: z.literal('cleanup_tick'), tenantId: z.literal(FEES_SYSTEM_TENANT) }),
  z.strictObject({
    kind: z.literal('cleanup'),
    tenantId: mediaTenant,
    hour: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}$/),
  }),
]);
export function mediaBusinessKey(p: z.output<typeof mediaPayload>): string {
  if (p.kind === 'slip') return `media:slip:${p.tenantId}:${p.uploadId}`;
  if (p.kind === 'cleanup') return `media:cleanup:${p.tenantId}:${p.hour}`;
  return 'media:cleanup_tick';
}

export interface JobDefinition<S extends z.ZodType> {
  schema: S;
  /** The business key: adding the same key twice is a no-op while the job exists. */
  jobId(payload: z.output<S>): string;
  /** Parallel jobs per worker process. */
  concurrency: number;
  /** BullMQ retention: how long finished jobs stay in Valkey. */
  removeOnComplete: { age: number; count?: number } | true;
  removeOnFail: { age: number; count?: number };
}

function defineJob<S extends z.ZodType>(def: JobDefinition<S>): JobDefinition<S> {
  return def;
}

const HOUR = 3600;
const DAY = 24 * HOUR;

/** Every queue's contract. Keys must match {@link QUEUES} (checked by the type). */
export const JOBS = {
  media: defineJob({
    schema: mediaPayload,
    jobId: (p) => encodeURIComponent(mediaBusinessKey(p)),
    // Image decoding is CPU-bound; keep it from starving the other queues.
    concurrency: 2,
    removeOnComplete: { age: DAY, count: 10000 },
    removeOnFail: { age: 14 * DAY },
  }),
  receipts: defineJob({ schema: receiptsPayload,
    jobId: p => encodeURIComponent(`receipt:${p.tenantId}:${p.paymentId}`), concurrency: 2,
    removeOnComplete: { age: DAY, count: 10000 }, removeOnFail: { age: 14 * DAY } }),
  fees: defineJob({
    schema: feesPayload,
    // Preserve the exact business key reversibly; BullMQ prohibits literal colons in job ids.
    jobId: p => encodeURIComponent(feesBusinessKey(p)), concurrency: 4,
    removeOnComplete: { age: DAY, count: 10000 }, removeOnFail: { age: 14 * DAY },
  }),
  sms: defineJob({
    schema: smsPayload,
    jobId: (p) => smsJobId(p.tenantId, p.messageId),
    concurrency: 10,
    // The text can hold an OTP code: keep it in Valkey no longer than needed.
    removeOnComplete: true,
    removeOnFail: { age: HOUR },
  }),
  imports: defineJob({
    schema: importsPayload,
    jobId: (p) => `import-${p.tenantId}-${p.importId}`,
    concurrency: 2,
    removeOnComplete: { age: HOUR, count: 1000 },
    removeOnFail: { age: 14 * DAY },
  }),
} satisfies { [Q in QueueName]: unknown };

export type JobPayload<Q extends QueueName> = z.output<(typeof JOBS)[Q]['schema']>;

/** Retry policy for every queue: 5 attempts, exponential backoff from 5 s (5, 10, 20, 40 s). */
export const DEFAULT_JOB_OPTIONS = {
  attempts: 5,
  backoff: { type: 'exponential', delay: 5000 },
} as const;

/** Where a processor runs: job id, 1-based attempt number. */
export interface JobContext {
  queue: QueueName;
  jobId: string;
  attempt: number;
}

/** Processors must be idempotent: BullMQ retries, and a stalled job can run twice. */
export type JobProcessor<Q extends QueueName> = (
  payload: JobPayload<Q>,
  ctx: JobContext,
) => Promise<void>;

/** Validate a payload for a queue and compute its business-key job id. Throws `ZodError`. */
export function prepareJob<Q extends QueueName>(
  queue: Q,
  payload: unknown,
): { payload: JobPayload<Q>; jobId: string } {
  const def = JOBS[queue] as JobDefinition<z.ZodType>;
  const parsed = def.schema.parse(payload) as JobPayload<Q>;
  return { payload: parsed, jobId: def.jobId(parsed) };
}
