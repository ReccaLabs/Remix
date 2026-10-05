import { PLAN_IDS, sriLankaMobile, tenantSlugSchema } from '@remix/types';
import { and, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import type { Db } from './client';
import { hashPassword, temporaryPassword } from './password';
import { auditLogs, sessions, staffRoles, tenants, tenantUsers } from './schema';

const singleLine = (min: number, max: number) =>
  z
    .string()
    .trim()
    .min(min)
    .max(max)
    .regex(/^[^\p{Cc}]*$/u, 'No control characters')
    .transform((v) => v.normalize('NFC'));

/** Input of `pnpm tenant:create` (platform provisioning, PLT-01 groundwork). */
export const createTenantInputSchema = z.strictObject({
  slug: tenantSlugSchema,
  name: singleLine(2, 120),
  plan: z.enum(PLAN_IDS),
  ownerPhone: sriLankaMobile,
  ownerName: singleLine(1, 120),
  /** Globally unique student-number prefix; defaults to padded name initials. */
  studentNoPrefix: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{2,4}$/, 'Use 2–4 English letters')
    .optional(),
});
export type CreateTenantInput = z.input<typeof createTenantInputSchema>;

export interface CreatedTenant {
  tenantId: string;
  slug: string;
  ownerUserId: string;
  /** Shown once to the operator; only its Argon2id hash is stored. Must be changed at first login. */
  temporaryPassword: string;
}

export function defaultPrefix(name: string): string {
  const words = name
    .normalize('NFKD')
    .toUpperCase()
    .split(/\s+/)
    .map((w) => w.replace(/[^A-Z]/g, ''))
    .filter(Boolean);
  let prefix = words
    .map((w) => w[0])
    .join('')
    .slice(0, 4);
  for (const letter of words[0]?.slice(1) ?? '') {
    if (prefix.length >= 3) break;
    if (!prefix.includes(letter)) prefix += letter;
  }
  return prefix.length >= 2 ? prefix : `${prefix}ST`.slice(0, 3);
}

/** Name-derived alternatives first, then the finite English namespace, all in stable order. */
export function* studentPrefixCandidates(name: string): Generator<string> {
  const prefix = defaultPrefix(name);
  const seen = new Set<string>();
  const first =
    name
      .normalize('NFKD')
      .toUpperCase()
      .trim()
      .split(/\s+/)[0]
      ?.replace(/[^A-Z]/g, '') ?? '';
  const preferred = [
    prefix,
    first.slice(0, 4),
    `${prefix[0]}${prefix[2] ?? ''}${prefix[1] ?? ''}`,
    first.slice(0, 2),
  ];
  for (const candidate of preferred) {
    if (/^[A-Z]{2,4}$/.test(candidate) && !seen.has(candidate)) {
      seen.add(candidate);
      yield candidate;
    }
  }
  for (let length = 2; length <= 4; length++) {
    for (let n = 0; n < 26 ** length; n++) {
      let value = n;
      let candidate = '';
      for (let digit = 0; digit < length; digit++) {
        candidate = String.fromCharCode(65 + (value % 26)) + candidate;
        value = Math.floor(value / 26);
      }
      if (!seen.has(candidate)) yield candidate;
    }
  }
}

/**
 * Create a tenant (status `trial`) with its owner: a staff user with the `owner` role and a
 * random temporary password that must be changed at first login. One owner-role transaction;
 * audit-logged as a system action. Throws a ZodError on invalid input and a Postgres unique
 * violation (23505) when the slug is taken.
 */
export async function createTenant(owner: Db, input: CreateTenantInput): Promise<CreatedTenant> {
  const data = createTenantInputSchema.parse(input);
  const password = temporaryPassword();
  const passwordHash = await hashPassword(password);

  return owner.transaction(async (tx) => {
    let tenant: { id: string } | undefined;
    const candidates = data.studentNoPrefix
      ? [data.studentNoPrefix]
      : studentPrefixCandidates(data.name);
    for (const prefix of candidates) {
      const query = tx.insert(tenants).values({
        slug: data.slug,
        name: data.name,
        plan: data.plan,
        status: 'trial',
        studentNoPrefix: prefix,
      });
      [tenant] = await (
        data.studentNoPrefix
          ? query
          : query.onConflictDoNothing({ target: tenants.studentNoPrefix })
      ).returning({ id: tenants.id });
      if (tenant) break;
    }
    if (!tenant) throw new Error('createTenant: student prefix namespace exhausted');

    const [user] = await tx
      .insert(tenantUsers)
      .values({
        tenantId: tenant.id,
        kind: 'staff',
        phone: data.ownerPhone,
        displayName: data.ownerName,
        passwordHash,
        mustChangePassword: true,
      })
      .returning({ id: tenantUsers.id });
    if (!user) throw new Error('createTenant: owner insert returned nothing');

    await tx.insert(staffRoles).values({ tenantId: tenant.id, userId: user.id, role: 'owner' });
    await tx.insert(auditLogs).values({
      tenantId: tenant.id,
      actorKind: 'system',
      action: 'tenant.create',
      entity: 'tenant',
      entityId: tenant.id,
      after: { slug: data.slug, plan: data.plan, ownerUserId: user.id },
    });

    return {
      tenantId: tenant.id,
      slug: data.slug,
      ownerUserId: user.id,
      temporaryPassword: password,
    };
  });
}

/** Input of `pnpm tenant:reset-owner-password`. */
export const resetOwnerPasswordInputSchema = z.strictObject({
  slug: tenantSlugSchema,
  /** Only needed when the tenant has more than one owner. */
  ownerPhone: sriLankaMobile.optional(),
});
export type ResetOwnerPasswordInput = z.input<typeof resetOwnerPasswordInputSchema>;

export interface ResetOwnerPassword {
  tenantId: string;
  slug: string;
  ownerUserId: string;
  /** Shown once to the operator; only its Argon2id hash is stored. */
  temporaryPassword: string;
  revokedSessions: number;
}

/** Why a reset could not happen; the CLI prints `message` as is (no data beyond the slug). */
export class OwnerResetError extends Error {
  constructor(
    readonly reason: 'tenant_not_found' | 'no_owner' | 'ambiguous_owner',
    message: string,
  ) {
    super(message);
    this.name = 'OwnerResetError';
  }
}

/**
 * Give a tenant's owner a new random temporary password (lost password, or a first-login
 * password that was never changed — AUTH-07 will enforce `must_change_password` in Phase 2).
 * One owner-role transaction: the Argon2id hash replaces the old one, `must_change_password`
 * is set, every live session of that user is revoked (a stolen session dies with the old
 * password) and a system audit row records it without any secret. Throws a ZodError on invalid
 * input and an {@link OwnerResetError} when the tenant or its (single) owner cannot be found.
 */
export async function resetOwnerPassword(
  owner: Db,
  input: ResetOwnerPasswordInput,
  now: Date = new Date(),
): Promise<ResetOwnerPassword> {
  const data = resetOwnerPasswordInputSchema.parse(input);
  const password = temporaryPassword();
  const passwordHash = await hashPassword(password);

  return owner.transaction(async (tx) => {
    const [tenant] = await tx
      .select({ id: tenants.id })
      .from(tenants)
      .where(eq(tenants.slug, data.slug))
      .limit(1);
    if (!tenant) throw new OwnerResetError('tenant_not_found', `No tenant "${data.slug}".`);

    const owners = await tx
      .select({ id: tenantUsers.id })
      .from(tenantUsers)
      .innerJoin(
        staffRoles,
        and(
          eq(staffRoles.tenantId, tenantUsers.tenantId),
          eq(staffRoles.userId, tenantUsers.id),
          eq(staffRoles.role, 'owner'),
        ),
      )
      .where(
        and(
          eq(tenantUsers.tenantId, tenant.id),
          eq(tenantUsers.kind, 'staff'),
          data.ownerPhone ? eq(tenantUsers.phone, data.ownerPhone) : undefined,
        ),
      );
    if (owners.length === 0) {
      throw new OwnerResetError('no_owner', `Tenant "${data.slug}" has no matching owner.`);
    }
    const [target] = owners;
    if (owners.length > 1 || !target) {
      throw new OwnerResetError(
        'ambiguous_owner',
        `Tenant "${data.slug}" has several owners: pass --owner-phone.`,
      );
    }

    await tx
      .update(tenantUsers)
      .set({ passwordHash, mustChangePassword: true })
      .where(and(eq(tenantUsers.tenantId, tenant.id), eq(tenantUsers.id, target.id)));

    const revoked = await tx
      .update(sessions)
      .set({ revokedAt: now, revokedReason: 'password_reset' })
      .where(
        and(
          eq(sessions.tenantId, tenant.id),
          eq(sessions.userId, target.id),
          isNull(sessions.revokedAt),
        ),
      )
      .returning({ id: sessions.id });

    await tx.insert(auditLogs).values({
      tenantId: tenant.id,
      actorKind: 'system',
      action: 'user.password_reset',
      entity: 'user',
      entityId: target.id,
      after: { via: 'cli', mustChangePassword: true, revokedSessions: revoked.length },
      createdAt: now,
    });

    return {
      tenantId: tenant.id,
      slug: data.slug,
      ownerUserId: target.id,
      temporaryPassword: password,
      revokedSessions: revoked.length,
    };
  });
}
