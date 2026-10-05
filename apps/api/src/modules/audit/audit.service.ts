import { isIP } from 'node:net';
import { Injectable } from '@nestjs/common';
import { schema, type ActorKind, type Tx } from '@remix/db';
import { currentContext } from '../../common/context/request-context';

/** Audited auth/session events (dotted verbs, `audit_logs.action`). */
export type AuditAction =
  | 'card.issue'
  | 'card.activate'
  | 'card.revoke'
  | 'settings.payhere_update'
  | 'settings.payhere_test'
  | 'settings.fees_update'
  | 'payment.record'
  | 'payment.reverse'
  | 'auth.login.succeeded'
  | 'auth.login.failed'
  | 'auth.login.temporary_password'
  | 'auth.logout'
  | 'session.reuse_detected'
  // Phase 2 (AUTH-02/03/04/05/07/08/09)
  | 'auth.lockout'
  | 'auth.unlock'
  | 'auth.password.set'
  | 'auth.password.changed'
  | 'auth.password.reset_by_staff'
  | 'auth.device.signed_out'
  | 'auth.device.trusted'
  | 'auth.two_step.verified'
  | 'staff.invite.accepted'
  // People (Phase 2, track B): archive, role and settings changes.
  | 'student.create'
  | 'student.update'
  | 'student.archive'
  | 'student.reactivate'
  | 'student.move_class'
  | 'student.devices_sign_out'
  | 'staff.invite'
  | 'staff.invite_revoke'
  | 'staff.role_change'
  | 'staff.scope_change'
  | 'staff.disable'
  | 'staff.enable'
  // Student import (STU-04): one event per committed import.
  | 'import.students'
  // Classes (Phase 2, track C): classes, halls, enrolments and fee overrides, institute settings.
  | 'class.create'
  | 'class.update'
  | 'class.archive'
  | 'hall.create'
  | 'hall.update'
  | 'hall.delete'
  | 'enrollment.create'
  | 'enrollment.update'
  | 'enrollment.end'
  | 'enrollment.move'
  | 'enrollment.fee_override'
  | 'settings.theme_update'
  | 'settings.general_update';

export interface AuditEntry {
  action: AuditAction;
  actorId: string | null;
  actorKind: ActorKind;
  entity: string;
  entityId: string | null;
  /**
   * Structured detail. Never a password, a token, a token hash or a full phone number/email:
   * use {@link maskIdentifier}.
   */
  after?: Record<string, unknown>;
  /** Previous values of what changed (same PII rules as `after`). */
  before?: Record<string, unknown>;
  at: Date;
}

/**
 * Append-only audit trail (`audit_logs`; the app role has INSERT + SELECT only). Writes go
 * through the caller's `withTenant` transaction, so they commit or roll back with the change
 * they describe, and RLS pins them to the tenant. Each row records the request id and the
 * client IP as the API sees it (trusted forwarding only, ADR 0003).
 */
@Injectable()
export class AuditService {
  async record(tx: Tx, tenantId: string, entry: AuditEntry): Promise<void> {
    await this.recordMany(tx, tenantId, [entry]);
  }

  /** One INSERT for several entries (bulk actions write one row per affected entity). */
  async recordMany(tx: Tx, tenantId: string, entries: readonly AuditEntry[]): Promise<void> {
    if (entries.length === 0) return;
    const ctx = currentContext();
    const ip = ctx?.clientIp && isIP(ctx.clientIp) ? ctx.clientIp : null;
    await tx.insert(schema.auditLogs).values(
      entries.map((entry) => ({
        tenantId,
        actorId: entry.actorId,
        actorKind: entry.actorKind,
        action: entry.action,
        entity: entry.entity,
        entityId: entry.entityId,
        before: entry.before ?? null,
        after: entry.after ?? null,
        ip,
        requestId: ctx?.requestId ?? null,
        createdAt: entry.at,
      })),
    );
  }
}

/**
 * A login identifier as it may appear in an audit row: enough to correlate attempts, not enough
 * to recover the number or address. `+94771234567` → `+94*******67`; `a.b@x.lk` → `*@x.lk`.
 */
export function maskIdentifier(
  identifier: { kind: 'phone'; phone: string } | { kind: 'email'; email: string } | null,
): string | null {
  if (!identifier) return null;
  if (identifier.kind === 'phone') {
    const p = identifier.phone;
    return p.length > 5 ? `${p.slice(0, 3)}${'*'.repeat(p.length - 5)}${p.slice(-2)}` : '*';
  }
  const at = identifier.email.lastIndexOf('@');
  return at >= 0 ? `*${identifier.email.slice(at)}` : '*';
}
