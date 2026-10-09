import { createHash } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { sql, type SQL } from 'drizzle-orm';
import { schema, withTenant, type Db, type Tx } from '@remix/db';
import type {
  ReminderPreview,
  ReminderTarget,
  SendRemindersRequest,
  SendRemindersResponse,
} from '@remix/types/api';
import { SMS_SEGMENT_PRICE_CENTS } from '@remix/types/api';
import type { AuthSession } from '../../common/auth/session-authenticator';
import { AppException } from '../../common/errors/app-exception';
import { addDays, calendarDate } from '../../common/time/business-date';
import { CLOCK, type Clock } from '../../common/time/clock';
import { AuditService } from '../audit/audit.service';
import { DB } from '../db/db.module';
import { projectionCtes, safeCents } from '../fees/projections';
import { renderSmsTemplate } from './sms-templates';
import { SmsWalletService } from './sms-wallet.service';
import {
  InsufficientSmsBalanceError,
  SystemSmsService,
  type SystemSmsItem,
} from './system-sms.service';

/** One call may text at most this many guardians; larger sets must be narrowed by class/month. */
export const MAX_REMINDERS_PER_SEND = 2000;

export interface ReminderCandidate {
  invoiceId: string;
  studentName: string;
  /** `2026-10` */
  month: string;
  dueOn: string;
  openCents: number;
  /** First guardian who opted in to SMS, else the student's own mobile; null when none. */
  phone: string | null;
  overdue: boolean;
}

interface CandidateRow extends Record<string, unknown> {
  id: string;
  month: string;
  due_on: string;
  total_cents: string;
  paid_cents: string;
  display_name: string;
  phone: string | null;
}

/** Sri Lankan mobiles only: the `sms` queue rejects anything else. */
const MOBILE = sql.raw(`'^\\+947[0-9]{8}$'`);
/** Aliases `s` (students) and `u` (tenant_users) must be in scope. */
const RECIPIENT = sql`coalesce(
  (select g.phone from public.guardians g
    where g.tenant_id = s.tenant_id and g.student_id = s.user_id and g.sms_opt_in and g.phone ~ ${MOBILE}
    order by g.created_at, g.id limit 1),
  case when u.phone ~ ${MOBILE} then u.phone end)`;
export { RECIPIENT as FEE_SMS_RECIPIENT_SQL };

export interface CandidateFilter {
  /** First day of the month, `2026-10-01`. */
  month?: string;
  /** Invoices due exactly on this date. */
  dueOn?: string;
  /** 'overdue' = projection status overdue; 'unpaid' = anything not fully paid. */
  filter?: 'unpaid' | 'overdue';
  classId?: string;
}

/** Unpaid invoices of active/invited students matching the filter, with their SMS recipient. */
export async function findReminderCandidates(
  tx: Tx,
  now: Date,
  f: CandidateFilter,
): Promise<ReminderCandidate[]> {
  const today = calendarDate(now);
  const where: SQL[] = [sql`p.status <> 'paid'`, sql`u.status <> 'disabled'`];
  if (f.month) where.push(sql`p.month = ${f.month}`);
  if (f.dueOn) where.push(sql`p.due_on = ${f.dueOn}`);
  if (f.filter === 'overdue') where.push(sql`p.status = 'overdue'`);
  if (f.classId) {
    where.push(
      sql`exists (select 1 from public.invoice_lines l where l.invoice_id = p.id and l.class_id = ${f.classId}::uuid and l.voided_at is null)`,
    );
  }
  const rows = (
    await tx.execute<CandidateRow>(sql`${projectionCtes(now)}
      select p.id, p.month, p.due_on, p.total_cents, p.paid_cents, u.display_name, ${RECIPIENT} as phone
      from projections p
      join public.students s on s.user_id = p.student_id
      join public.tenant_users u on u.tenant_id = s.tenant_id and u.id = s.user_id
      where ${sql.join(where, sql` and `)}
      order by p.due_on, p.id
      limit ${MAX_REMINDERS_PER_SEND + 1}`)
  ).rows;
  return rows
    .map((r) => ({
      invoiceId: r.id,
      studentName: r.display_name,
      month: r.month.slice(0, 7),
      dueOn: r.due_on,
      openCents: safeCents(r.total_cents) - safeCents(r.paid_cents),
      phone: r.phone,
      overdue: today > r.due_on,
    }))
    .filter((c) => c.openCents > 0);
}

type FeeTemplate = 'fee_reminder_before' | 'fee_reminder_overdue';

function templateFor(candidate: ReminderCandidate): FeeTemplate {
  return candidate.overdue ? 'fee_reminder_overdue' : 'fee_reminder_before';
}

function varsFor(candidate: ReminderCandidate) {
  return {
    student: candidate.studentName,
    month: candidate.month,
    amountCents: candidate.openCents,
    dueOn: candidate.dueOn,
  };
}

/** `rm-<16 hex of the client key>-<invoice id>`: one manual send per key and invoice. */
export function manualReminderId(idempotencyKey: string, invoiceId: string): string {
  return `rm-${createHash('sha256').update(idempotencyKey).digest('hex').slice(0, 16)}-${invoiceId}`;
}

/** `rem-before-<invoice id>` / `rem-overdue-<invoice id>`: one automatic reminder per invoice and kind. */
export function automaticReminderId(kind: 'before' | 'overdue', invoiceId: string): string {
  return `rem-${kind}-${invoiceId}`;
}

export interface AutomaticRemindersResult {
  candidates: number;
  sent: number;
  skippedNoMobile: number;
  /** The wallet ran out part-way: the rest are not retried (the day has passed). */
  stoppedForBalance: boolean;
}

@Injectable()
export class FeeRemindersService {
  private readonly logger = new Logger('FeeReminders');

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly sms: SystemSmsService,
    private readonly wallet: SmsWalletService,
    private readonly audit: AuditService,
  ) {}

  /** FEE-02 dialog: who would be texted, what it costs, and whether the wallet covers it. */
  async preview(tenantId: string, target: ReminderTarget): Promise<ReminderPreview> {
    const { candidates, tenantName, locale, balance } = await this.load(tenantId, target);
    const withPhone = candidates.filter((c) => c.phone);
    let segments = 0;
    for (const c of withPhone) {
      segments += renderSmsTemplate(
        templateFor(c),
        { ...varsFor(c), institute: tenantName },
        locale,
      ).segments;
    }
    const sample = withPhone[0];
    return {
      recipients: withPhone.length,
      segments,
      costCents: segments * SMS_SEGMENT_PRICE_CENTS,
      balanceCents: balance,
      sampleText: renderSmsTemplate(
        sample ? templateFor(sample) : 'fee_reminder_before',
        sample
          ? { ...varsFor(sample), institute: tenantName }
          : {
              institute: tenantName,
              student: 'Student Name',
              month: target.month.slice(0, 7),
              amountCents: 250_000,
              dueOn: `${target.month.slice(0, 8)}05`,
            },
        locale,
      ).text,
    };
  }

  /**
   * FEE-02 "Send reminder SMS to N unpaid". 409 INSUFFICIENT_BALANCE with nothing debited or
   * queued when the wallet cannot cover every new message; the same idempotency key sends once.
   */
  async send(
    tenantId: string,
    session: AuthSession,
    body: SendRemindersRequest,
  ): Promise<SendRemindersResponse> {
    const { candidates } = await this.load(tenantId, body);
    const targets = candidates.filter((c) => c.phone);
    const items: SystemSmsItem<FeeTemplate>[] = targets.map((c) => ({
      template: templateFor(c),
      vars: varsFor(c),
      to: c.phone ?? '',
      idempotencyKey: manualReminderId(body.idempotencyKey, c.invoiceId),
    }));
    let results;
    try {
      results = await this.sms.sendAll(tenantId, items);
    } catch (error) {
      if (error instanceof InsufficientSmsBalanceError) {
        throw new AppException('INSUFFICIENT_BALANCE', 409, 'Not enough SMS balance', {
          detail: 'Buy more SMS in Settings, or narrow the list by class.',
        });
      }
      throw error;
    }
    const costCents = results.reduce((sum, r) => sum + r.costCents, 0);
    if (results.some((r) => r.status === 'queued')) {
      await withTenant(this.db, tenantId, (tx) =>
        this.audit.record(tx, tenantId, {
          actorId: session.userId,
          actorKind: 'staff',
          action: 'sms.reminders_send',
          entity: 'invoice',
          entityId: null,
          after: {
            month: body.month,
            filter: body.filter,
            classId: body.classId ?? null,
            recipients: results.length,
            costCents,
          },
          at: this.clock.now(),
        }),
      );
    }
    return { queued: results.length, costCents };
  }

  /**
   * FEE-12: the reminders that fall due on `date` (an Asia/Colombo calendar date): invoices due
   * `remindBeforeDays` from now, and invoices that became overdue `remindAfterDays` ago. The
   * message id is per invoice and kind, so running the job twice sends nothing new.
   */
  async runAutomatic(tenantId: string, date: string): Promise<AutomaticRemindersResult> {
    const result: AutomaticRemindersResult = {
      candidates: 0,
      sent: 0,
      skippedNoMobile: 0,
      stoppedForBalance: false,
    };
    const settings = await withTenant(this.db, tenantId, async (tx) => {
      const [row] = await tx.select().from(schema.tenantSettings);
      return row;
    });
    if (!settings?.remindersEnabled) return result;
    await this.wallet.refundStalePending(tenantId);

    const now = this.clock.now();
    const plan = [
      { kind: 'before' as const, dueOn: addDays(date, settings.remindBeforeDays) },
      { kind: 'overdue' as const, dueOn: addDays(date, -settings.remindAfterDays) },
    ];
    for (const { kind, dueOn } of plan) {
      const candidates = await withTenant(this.db, tenantId, (tx) =>
        findReminderCandidates(tx, now, { dueOn }),
      );
      result.candidates += candidates.length;
      for (const c of candidates) {
        if (!c.phone) {
          result.skippedNoMobile += 1;
          continue;
        }
        // The kind follows the plan, not "today > due": a 1-day-overdue reminder is an overdue one.
        const template: FeeTemplate = kind === 'before' ? 'fee_reminder_before' : 'fee_reminder_overdue';
        try {
          const sent = await this.sms.send<FeeTemplate>(
            tenantId,
            template,
            varsFor(c),
            c.phone,
            automaticReminderId(kind, c.invoiceId),
          );
          if (sent.status === 'queued') result.sent += 1;
        } catch (error) {
          if (error instanceof InsufficientSmsBalanceError) {
            result.stoppedForBalance = true;
            this.logger.warn({ tenantId, date, sent: result.sent }, 'Fee reminders stopped: SMS wallet is empty');
            return result;
          }
          throw error;
        }
      }
    }
    return result;
  }

  private async load(tenantId: string, target: ReminderTarget) {
    return withTenant(this.db, tenantId, async (tx) => {
      const [tenant] = await tx
        .select({ name: schema.tenants.name, locale: schema.tenants.defaultLocale })
        .from(schema.tenants);
      const candidates = await findReminderCandidates(tx, this.clock.now(), {
        month: target.month,
        filter: target.filter,
        classId: target.classId,
      });
      if (candidates.length > MAX_REMINDERS_PER_SEND) {
        throw new AppException(
          'VALIDATION_FAILED',
          400,
          'Too many unpaid students for one reminder run',
          { detail: `Choose a class to send at most ${MAX_REMINDERS_PER_SEND} at a time.` },
        );
      }
      const balance = (
        await tx.execute<{ b: string }>(sql`select coalesce(max(balance_cents), 0)::text as b from public.sms_wallets`)
      ).rows[0]?.b;
      return {
        candidates,
        tenantName: tenant?.name ?? '',
        locale: tenant?.locale ?? 'en',
        balance: Number(balance ?? 0),
      };
    });
  }
}
