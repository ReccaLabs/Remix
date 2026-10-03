import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { schema, withTenant, type Db } from '@remix/db';
import type { ImportJob, ImportPreviewResponse, importRowResultSchema } from '@remix/types';
import { API } from '@remix/types';
import type { z } from 'zod';
import type { AuthSession } from '../../common/auth/session-authenticator';
import { AppException } from '../../common/errors/app-exception';
import type { EndpointBody } from '../../common/validation/endpoint';
import { JOB_PRODUCER, JobQueueUnavailableError, type JobProducer } from '../../jobs/job-producer';
import { DB } from '../db/db.module';
import { loadValidationContext } from './import-context';
import { validateStudentRows } from './row-validator';

const { importJobs } = schema;

type ImportBody = EndpointBody<typeof API.commitStudentImport>;
type RowResults = z.output<typeof importRowResultSchema>[];

const notFound = () => new AppException('NOT_FOUND', 404, 'Import not found');

/**
 * STU-04 / DAT-01 — the request side of student imports: the synchronous dry run, queuing a
 * commit on the `imports` queue and reading a job back. The writing is {@link ImportRunner}.
 */
@Injectable()
export class ImportsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(JOB_PRODUCER) private readonly jobs: JobProducer,
  ) {}

  /** Dry run: validate against the tenant's current data, write nothing. */
  preview(tenantId: string, body: ImportBody): Promise<ImportPreviewResponse> {
    return withTenant(this.db, tenantId, async (tx) => {
      const context = await loadValidationContext(tx, body.rows);
      const { results, summary } = validateStudentRows(body.rows, context);
      return { summary, rows: results };
    });
  }

  /** Store the mapped rows as a `queued` job and put it on the queue (202). */
  async commit(tenantId: string, session: AuthSession, body: ImportBody): Promise<ImportJob> {
    const job = await withTenant(this.db, tenantId, async (tx) => {
      const [row] = await tx
        .insert(importJobs)
        .values({
          tenantId,
          createdBy: session.userId,
          options: { enrolFrom: body.enrolFrom, sendWelcomeSms: body.sendWelcomeSms },
          input: body.rows,
        })
        .returning();
      if (!row) throw new Error('import job not created');
      return row;
    });
    try {
      await this.jobs.add('imports', { tenantId, importId: job.id });
    } catch (error) {
      // Nothing was queued, so nothing will ever run this row: remove it and let the user retry.
      await withTenant(this.db, tenantId, (tx) =>
        tx.delete(importJobs).where(eq(importJobs.id, job.id)),
      );
      if (error instanceof JobQueueUnavailableError) {
        throw new AppException(
          'INTERNAL',
          503,
          'Service temporarily unavailable. Try again shortly.',
          { headers: { 'retry-after': '5' } },
        );
      }
      throw error;
    }
    // With an inline producer (development) the job already ran: answer with its current state.
    return this.get(tenantId, job.id);
  }

  get(tenantId: string, id: string): Promise<ImportJob> {
    return withTenant(this.db, tenantId, async (tx) => {
      const [row] = await tx.select().from(importJobs).where(eq(importJobs.id, id));
      if (!row) throw notFound();
      return {
        id: row.id,
        status: row.status,
        createdAt: row.createdAt.toISOString(),
        finishedAt: row.finishedAt?.toISOString() ?? null,
        summary: row.summary as ImportJob['summary'],
        created: row.created,
        enrolled: row.enrolled,
        rows: row.resultRows as RowResults | null,
      };
    });
  }
}
