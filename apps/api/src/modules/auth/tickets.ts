import { and, eq, gt, isNull, lt, sql } from 'drizzle-orm';
import { schema, type AuthTicketKind, type Tx } from '@remix/db';
import { OTP_RULES, type OtpPurpose } from '@remix/types/api';
import { hashToken, isOpaqueToken, newOpaqueToken } from './tokens';

const { authTickets } = schema;

/** Lifetimes (contract: device-limit 5 min, two-step and password tickets 10 min). */
export const TICKET_TTL_SEC: Record<AuthTicketKind, number> = {
  device_limit: 5 * 60,
  two_step: OTP_RULES.ttlSeconds,
  password: 10 * 60,
};

export interface NewTicket {
  id: string;
  /** The raw ticket: returned to the browser once, never stored or logged. */
  token: string;
  expiresAt: Date;
}

export interface OpenTicket {
  id: string;
  userId: string;
  purpose: OtpPurpose | null;
  codeHash: string | null;
  attempts: number;
  sends: number;
  lastSentAt: Date | null;
  staySignedIn: boolean;
  expiresAt: Date;
}

export async function createTicket(
  tx: Tx,
  tenantId: string,
  input: {
    userId: string;
    kind: AuthTicketKind;
    now: Date;
    staySignedIn?: boolean;
    purpose?: OtpPurpose;
    codeHash?: string;
  },
): Promise<NewTicket> {
  const token = newOpaqueToken();
  const expiresAt = new Date(input.now.getTime() + TICKET_TTL_SEC[input.kind] * 1000);
  const [row] = await tx
    .insert(authTickets)
    .values({
      tenantId,
      userId: input.userId,
      kind: input.kind,
      tokenHash: hashToken(token),
      purpose: input.purpose ?? null,
      codeHash: input.codeHash ?? null,
      sends: input.codeHash ? 1 : 0,
      lastSentAt: input.codeHash ? input.now : null,
      staySignedIn: input.staySignedIn ?? false,
      expiresAt,
      createdAt: input.now,
      updatedAt: input.now,
    })
    .returning({ id: authTickets.id });
  if (!row) throw new Error('Ticket insert returned nothing');
  return { id: row.id, token, expiresAt };
}

/**
 * The unspent, unexpired ticket of `kind` for a presented raw token, or null. Lookup is by
 * SHA-256 inside the host tenant (RLS), so a ticket from another institute matches nothing.
 * Reading does not spend it; {@link spendTicket} does.
 */
export async function findOpenTicket(
  tx: Tx,
  tenantId: string,
  kind: AuthTicketKind,
  token: string,
  now: Date,
  options: { forUpdate?: boolean } = {},
): Promise<OpenTicket | null> {
  if (!isOpaqueToken(token)) return null;
  const query = tx
    .select({
      id: authTickets.id,
      userId: authTickets.userId,
      purpose: authTickets.purpose,
      codeHash: authTickets.codeHash,
      attempts: authTickets.attempts,
      sends: authTickets.sends,
      lastSentAt: authTickets.lastSentAt,
      staySignedIn: authTickets.staySignedIn,
      expiresAt: authTickets.expiresAt,
    })
    .from(authTickets)
    .where(
      and(
        eq(authTickets.tenantId, tenantId),
        eq(authTickets.kind, kind),
        eq(authTickets.tokenHash, hashToken(token)),
        isNull(authTickets.consumedAt),
        gt(authTickets.expiresAt, now),
      ),
    )
    .limit(1);
  const [row] = options.forUpdate ? await query.for('update') : await query;
  return row ?? null;
}

/**
 * Spend a ticket: one conditional UPDATE, so of two concurrent requests holding the same ticket
 * exactly one gets `true` (the other's UPDATE re-checks `consumed_at` after the first commits
 * and matches nothing). Two-step tickets must also still be under the attempt limit.
 */
export async function spendTicket(
  tx: Tx,
  tenantId: string,
  id: string,
  now: Date,
): Promise<boolean> {
  const rows = await tx
    .update(authTickets)
    .set({ consumedAt: now })
    .where(
      and(
        eq(authTickets.tenantId, tenantId),
        eq(authTickets.id, id),
        isNull(authTickets.consumedAt),
        gt(authTickets.expiresAt, now),
        lt(authTickets.attempts, OTP_RULES.maxAttempts),
      ),
    )
    .returning({ id: authTickets.id });
  return rows.length === 1;
}

/** One wrong two-step code: count it, and burn the ticket at the attempt limit. */
export async function failTicketAttempt(
  tx: Tx,
  tenantId: string,
  id: string,
  now: Date,
): Promise<void> {
  await tx
    .update(authTickets)
    .set({
      attempts: sql`${authTickets.attempts} + 1`,
      consumedAt: sql`case when ${authTickets.attempts} + 1 >= ${OTP_RULES.maxAttempts} then ${now}::timestamptz else ${authTickets.consumedAt} end`,
    })
    .where(and(eq(authTickets.tenantId, tenantId), eq(authTickets.id, id)));
}
