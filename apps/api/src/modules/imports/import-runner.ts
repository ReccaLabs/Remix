import { Inject, Injectable, Logger } from '@nestjs/common';
import { UnrecoverableError } from 'bullmq';
import { and, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import {
  advanceCounter,
  studentNumberFloor,
  allocateNumbers,
  formatStudentNo,
  schema,
  withTenant,
  type Db,
  type Tx,
} from '@remix/db';
import { importRowSchema, type ImportRowResult } from '@remix/types';
import { monthStart } from '../../common/time/business-date';
import { CLOCK, type Clock } from '../../common/time/clock';
import { DEFAULT_JOB_OPTIONS, type JobContext, type JobPayload } from '../../jobs/queues';
import { AuditService } from '../audit/audit.service';
import { DB } from '../db/db.module';
import { PeopleHooks, type StudentInvitedEvent } from '../people/people-hooks';
import { loadValidationContext } from './import-context';
import { validateStudentRows, type ValidStudent } from './row-validator';

const { importJobs, tenantUsers, students, guardians, enrollments, tenants } = schema;

/** Rows per INSERT: keeps every statement far below Postgres' 65,535 bind-parameter limit. */
const CHUNK = 1000;

const optionsSchema = z.object({
  enrolFrom: z.string().optional(),
  sendWelcomeSms: z.boolean().default(false),
});

/** Why a finished or vanished job is skipped; useful in logs and tests. */
export type RunOutcome = 'done' | 'skipped';

function chunks<T>(list: readonly T[], size = CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

/**
 * STU-04 — the `imports` queue processor (ADR 0012). Safe to run twice for one job id: the job
 * row is claimed with `FOR UPDATE` and a job that is already `done`/`failed` is left alone, so a
 * retry or a stalled-job re-delivery never creates a student twice.
 *
 * Steps: mark `running`; then, in ONE transaction: lock the job, re-validate every row against
 * the database as it is now (never trusting the preview), insert the `ok` rows (users, students,
 * guardians, enrolments) with student numbers taken from the counter in one block, store the
 * result on the job and write one audit event. Welcome SMS go out after the commit.
 */
@Injectable()
export class ImportRunner {
  private readonly logger = new Logger('Imports');

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly audit: AuditService,
    private readonly hooks: PeopleHooks,
  ) {}

  /** The `imports` queue processor. */
  async run(payload: JobPayload<'imports'>, ctx?: JobContext): Promise<RunOutcome> {
    const { tenantId, importId } = payload;
    try {
      const claimed = await withTenant(this.db, tenantId, async (tx) => {
        const rows = await tx
          .update(importJobs)
          .set({ status: 'running', startedAt: this.clock.now() })
          .where(
            and(eq(importJobs.id, importId), inArray(importJobs.status, ['queued', 'running'])),
          )
          .returning({ id: importJobs.id });
        return rows.length > 0;
      });
      if (!claimed) {
        this.logger.warn({ tenantId, importId }, 'Import job is missing or already finished');
        return 'skipped';
      }
      const invited = await this.execute(tenantId, importId);
      if (!invited) return 'skipped';
      for (const event of invited) await this.hooks.onStudentInvited(event);
      return 'done';
    } catch (error) {
      const final =
        error instanceof UnrecoverableError ||
        (ctx?.attempt ?? DEFAULT_JOB_OPTIONS.attempts) >= DEFAULT_JOB_OPTIONS.attempts;
      if (final) await this.markFailed(tenantId, importId);
      // Never log row contents: they are personal data. The error class and message are enough.
      this.logger.error(
        { tenantId, importId, attempt: ctx?.attempt, err: (error as Error).message },
        'Import job attempt failed',
      );
      throw error;
    }
  }

  /** The transaction. Returns the welcome-SMS events, or null when the job was already finished. */
  private execute(tenantId: string, importId: string): Promise<StudentInvitedEvent[] | null> {
    return withTenant(this.db, tenantId, async (tx) => {
      const [job] = await tx
        .select()
        .from(importJobs)
        .where(eq(importJobs.id, importId))
        .for('update');
      if (!job || (job.status !== 'queued' && job.status !== 'running')) return null;

      const rows = z.array(importRowSchema).parse(job.input);
      const options = optionsSchema.parse(job.options);
      const now = this.clock.now();
      const month = options.enrolFrom ?? monthStart(now);

      // Serialize with Add student and other imports BEFORE reading the duplicate context.
      // A competing allocation that commits first must be visible to re-validation.
      await advanceCounter(tx, 'student', 0);
      const context = await loadValidationContext(tx, rows);
      const outcome = validateStudentRows(rows, context);
      const created = await this.write(tx, tenantId, job.createdBy, outcome.valid, month, now);

      await tx
        .update(importJobs)
        .set({
          status: 'done',
          finishedAt: now,
          summary: outcome.summary,
          resultRows: outcome.results satisfies ImportRowResult[],
          created: created.students.length,
          enrolled: created.enrolled,
          input: null,
        })
        .where(eq(importJobs.id, importId));
      await this.audit.record(tx, tenantId, {
        action: 'import.students',
        actorId: job.createdBy,
        actorKind: 'staff',
        entity: 'import',
        entityId: importId,
        after: {
          total: outcome.summary.total,
          created: created.students.length,
          enrolled: created.enrolled,
          errors: outcome.summary.errors,
          duplicates: outcome.summary.duplicates,
        },
        at: now,
      });
      return options.sendWelcomeSms ? created.students : [];
    });
  }

  private async write(
    tx: Tx,
    tenantId: string,
    createdBy: string,
    valid: readonly ValidStudent[],
    month: string,
    now: Date,
  ): Promise<{ students: StudentInvitedEvent[]; enrolled: number }> {
    if (valid.length === 0) return { students: [], enrolled: 0 };

    const [tenant] = await tx
      .select({ prefix: tenants.studentNoPrefix })
      .from(tenants)
      .where(eq(tenants.id, tenantId));
    if (!tenant) throw new UnrecoverableError('tenant row missing inside its own context');

    // Generated numbers come last-but-inserts: the counter row lock is held until commit.
    const kept = new Set(valid.flatMap((v) => (v.studentNo ? [v.studentNo] : [])));
    await advanceCounter(tx, 'student', studentNumberFloor(tenant.prefix, [...kept]));
    const generated = await this.generateNumbers(
      tx,
      tenant.prefix,
      valid.filter((v) => !v.studentNo).length,
      kept,
    );
    const numbers = valid.map((v) => v.studentNo ?? generated.shift() ?? '');

    const userIds = new Map<string, string>();
    for (const part of chunks(valid)) {
      const inserted = await tx
        .insert(tenantUsers)
        .values(
          part.map((v) => ({
            tenantId,
            kind: 'student' as const,
            phone: v.phone,
            displayName: v.displayName,
            status: 'invited' as const,
            passwordHash: null,
          })),
        )
        .returning({ id: tenantUsers.id, phone: tenantUsers.phone });
      for (const row of inserted) if (row.phone) userIds.set(row.phone, row.id);
    }
    const idOf = (v: ValidStudent): string => {
      const id = userIds.get(v.phone);
      if (!id) throw new Error('imported student user not created');
      return id;
    };

    for (const part of chunks(valid.map((v, i) => ({ v, no: numbers[i] ?? '' })))) {
      await tx.insert(students).values(
        part.map(({ v, no }) => ({
          tenantId,
          userId: idOf(v),
          studentNo: no,
          school: v.school,
          alYear: v.alYear,
          medium: v.medium,
          under18: v.under18,
          ...(v.under18
            ? {
                consentGivenBy: v.consentGivenBy,
                // The import has no channel column; an imported sheet is a paper record.
                consentMethod: 'paper_form' as const,
                consentRecordedAt: now,
                consentRecordedBy: createdBy,
              }
            : {}),
        })),
      );
    }

    const withGuardian = valid.filter((v) => v.guardian);
    for (const part of chunks(withGuardian)) {
      await tx.insert(guardians).values(
        part.flatMap((v) =>
          v.guardian
            ? [
                {
                  tenantId,
                  studentId: idOf(v),
                  name: v.guardian.name,
                  relation: v.guardian.relation,
                  phone: v.guardian.phone,
                  smsOptIn: true,
                },
              ]
            : [],
        ),
      );
    }

    const enrolments = valid.flatMap((v) =>
      v.classIds.map((classId) => ({
        tenantId,
        classId,
        studentId: idOf(v),
        fromMonth: month,
      })),
    );
    for (const part of chunks(enrolments, 2000)) await tx.insert(enrollments).values(part);

    return {
      students: valid.map((v) => ({
        tenantId,
        studentId: idOf(v),
        displayName: v.displayName,
        phone: v.phone,
      })),
      enrolled: enrolments.length,
    };
  }

  /**
   * `count` unused student numbers from the tenant counter, taken as one block. Numbers that
   * collide with an existing or a kept (imported) number are skipped and replaced from the next
   * block, so a sheet that brings its own numbers cannot make the commit fail.
   */
  private async generateNumbers(
    tx: Tx,
    prefix: string,
    count: number,
    reserved: ReadonlySet<string>,
  ): Promise<string[]> {
    const out: string[] = [];
    while (out.length < count) {
      const block = await allocateNumbers(tx, 'student', count - out.length);
      const candidates: string[] = [];
      for (let n = block.first; n <= block.last; n++) candidates.push(formatStudentNo(prefix, n));
      const taken = new Set<string>();
      for (const part of chunks(candidates, 5000)) {
        const rows = await tx
          .select({ studentNo: students.studentNo })
          .from(students)
          .where(inArray(students.studentNo, part));
        for (const row of rows) taken.add(row.studentNo);
      }
      for (const candidate of candidates) {
        if (!taken.has(candidate) && !reserved.has(candidate)) out.push(candidate);
      }
    }
    return out;
  }

  /** Final failure: the job row says so and drops the personal data it still holds. */
  private async markFailed(tenantId: string, importId: string): Promise<void> {
    try {
      await withTenant(this.db, tenantId, (tx) =>
        tx
          .update(importJobs)
          .set({ status: 'failed', finishedAt: this.clock.now(), input: null })
          .where(
            and(eq(importJobs.id, importId), inArray(importJobs.status, ['queued', 'running'])),
          ),
      );
    } catch (error) {
      this.logger.error(
        { tenantId, importId, err: (error as Error).message },
        'Could not mark the import job as failed',
      );
    }
  }
}
