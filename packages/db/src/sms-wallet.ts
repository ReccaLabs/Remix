import { and, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Db } from './client';
import { auditLogs, smsTopUpRequests, smsWalletLedger, smsWallets, tenants } from './schema';

const SLUG = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/;

/** Input of `pnpm tenant:sms-credit` (MSG-02 staff tooling until platform admin exists, Phase 7). */
export const creditSmsWalletInputSchema = z
  .strictObject({
    slug: z.string().regex(SLUG),
    /** Credit in cents (LKR x 100). Omit to only change the settings below. */
    amountCents: z.number().int().min(1).max(1_000_000_000).optional(),
    note: z.string().trim().min(3).max(200).optional(),
    /** The "Buy SMS" request this credit settles; it is marked credited. */
    requestId: z.uuid().optional(),
    /** Registered sender mask override; `null` goes back to the platform default. */
    senderId: z
      .string()
      .regex(/^[A-Za-z0-9]{3,11}$/)
      .nullable()
      .optional(),
    lowBalanceThresholdCents: z.number().int().min(0).max(100_000_000).optional(),
  })
  .refine(
    (v) =>
      v.amountCents !== undefined ||
      v.senderId !== undefined ||
      v.lowBalanceThresholdCents !== undefined,
    'Nothing to do: pass an amount, a sender id or a threshold',
  )
  .refine((v) => v.amountCents === undefined || v.note !== undefined, 'A credit needs a note')
  .refine((v) => v.requestId === undefined || v.amountCents !== undefined, 'A request needs an amount');
export type CreditSmsWalletInput = z.input<typeof creditSmsWalletInputSchema>;

export class SmsWalletToolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SmsWalletToolError';
  }
}

export interface CreditSmsWalletResult {
  tenantId: string;
  balanceCents: number;
  senderId: string | null;
}

/**
 * Credit a tenant's SMS wallet (and/or set its sender id and low-balance threshold) as the owner
 * role, in one transaction with the audit row. The credit is an ordinary ledger entry: the
 * trigger computes the balance, so it is exactly as safe as an app-side debit. Settling a "Buy
 * SMS" request marks it credited in the same transaction.
 */
export async function creditSmsWallet(
  owner: Db,
  input: CreditSmsWalletInput,
  now: Date = new Date(),
): Promise<CreditSmsWalletResult> {
  const data = creditSmsWalletInputSchema.parse(input);
  return owner.transaction(async (tx) => {
    const [tenant] = await tx.select({ id: tenants.id }).from(tenants).where(eq(tenants.slug, data.slug)).limit(1);
    if (!tenant) throw new SmsWalletToolError(`No tenant "${data.slug}".`);
    // FORCE RLS binds the owner role too: supply the tenant like withTenant() does.
    await tx.execute(sql`select pg_catalog.set_config('app.tenant_id', ${tenant.id}, true)`);

    if (data.requestId) {
      const [request] = await tx
        .select()
        .from(smsTopUpRequests)
        .where(and(eq(smsTopUpRequests.id, data.requestId), eq(smsTopUpRequests.tenantId, tenant.id)))
        .for('update');
      if (!request) throw new SmsWalletToolError('That top-up request does not belong to this tenant.');
      if (request.status !== 'requested') throw new SmsWalletToolError(`That request is already ${request.status}.`);
    }

    if (data.amountCents !== undefined) {
      await tx.insert(smsWalletLedger).values({
        tenantId: tenant.id,
        kind: 'top_up',
        amountCents: data.amountCents,
        note: data.note ?? null,
        createdAt: now,
      });
    } else {
      await tx.insert(smsWallets).values({ tenantId: tenant.id }).onConflictDoNothing();
    }

    const settings: Partial<typeof smsWallets.$inferInsert> = {};
    if (data.senderId !== undefined) settings.senderId = data.senderId;
    if (data.lowBalanceThresholdCents !== undefined) settings.lowBalanceThresholdCents = data.lowBalanceThresholdCents;
    if (Object.keys(settings).length > 0) {
      await tx.update(smsWallets).set(settings).where(eq(smsWallets.tenantId, tenant.id));
    }

    if (data.requestId) {
      await tx
        .update(smsTopUpRequests)
        .set({ status: 'credited', resolvedAt: now })
        .where(and(eq(smsTopUpRequests.id, data.requestId), eq(smsTopUpRequests.tenantId, tenant.id)));
    }

    const [wallet] = await tx.select().from(smsWallets).where(eq(smsWallets.tenantId, tenant.id));
    if (!wallet) throw new SmsWalletToolError('Wallet missing after update.');

    await tx.insert(auditLogs).values({
      tenantId: tenant.id,
      actorKind: 'system',
      action: data.amountCents !== undefined ? 'sms.wallet_top_up' : 'sms.wallet_settings',
      entity: 'sms_wallet',
      entityId: wallet.id,
      after: {
        via: 'cli',
        ...(data.amountCents !== undefined ? { amountCents: data.amountCents } : {}),
        balanceCents: wallet.balanceCents,
        ...(data.requestId ? { requestId: data.requestId } : {}),
        ...(data.senderId !== undefined ? { senderId: data.senderId } : {}),
        ...(data.lowBalanceThresholdCents !== undefined
          ? { lowBalanceThresholdCents: data.lowBalanceThresholdCents }
          : {}),
      },
      createdAt: now,
    });

    return { tenantId: tenant.id, balanceCents: wallet.balanceCents, senderId: wallet.senderId };
  });
}
