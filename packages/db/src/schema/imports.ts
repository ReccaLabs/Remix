import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { IMPORT_JOB_STATUSES } from '@remix/types';
import { id, instant, tenantId, timestamps } from './columns';
import { tenants } from './tenants';
import { tenantUsers } from './users';

export const importJobStatus = pgEnum('import_job_status', IMPORT_JOB_STATUSES);

/**
 * STU-04 / DAT-01 — one student import. The row is the job's state and its idempotency key
 * (`id` is the BullMQ business key): the worker locks it, does nothing when it is already
 * `done`/`failed`, and writes the students and this row's result in one transaction.
 *
 * There is no per-row table: rows are only ever read back as a whole (the preview and error file
 * of one job), at most 5,000 of them, so two JSON documents are simpler than 5,000 rows each.
 * The uploaded file itself is never stored (the browser parses it). `input` holds the mapped,
 * unvalidated string cells the worker needs and is cleared once the job finished, so personal
 * data does not outlive the work; `result_rows` keeps only row numbers, statuses and messages.
 */
export const importJobs = pgTable(
  'import_jobs',
  {
    id: id(),
    tenantId: tenantId().references(() => tenants.id, { onDelete: 'cascade' }),
    status: importJobStatus('status').notNull().default('queued'),
    createdBy: uuid('created_by').notNull(),
    /** `{ enrolFrom, sendWelcomeSms }` of the request. */
    options: jsonb('options').notNull(),
    /** The mapped rows (string cells) until the job finishes, then null. */
    input: jsonb('input'),
    summary: jsonb('summary'),
    resultRows: jsonb('result_rows'),
    created: integer('created'),
    enrolled: integer('enrolled'),
    startedAt: instant('started_at'),
    finishedAt: instant('finished_at'),
    ...timestamps(),
  },
  (t) => [
    foreignKey({
      name: 'import_jobs_created_by_fk',
      columns: [t.tenantId, t.createdBy],
      foreignColumns: [tenantUsers.tenantId, tenantUsers.id],
    }),
    unique('import_jobs_tenant_id_id_key').on(t.tenantId, t.id),
    index('import_jobs_tenant_created_idx').on(t.tenantId, t.createdAt),
    check(
      'import_jobs_finished_has_time',
      sql`${t.status} NOT IN ('done', 'failed') OR ${t.finishedAt} IS NOT NULL`,
    ),
  ],
);
