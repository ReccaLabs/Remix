import { PLAN_IDS, sriLankaMobile, tenantSlugSchema } from '@remix/types';
import { z } from 'zod';
import type { Db } from './client';
import { hashPassword, temporaryPassword } from './password';
import { auditLogs, staffRoles, tenants, tenantUsers } from './schema';

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
  /** Student-number prefix; defaults to the initials of the name (e.g. "Kamal Physics" → "KP"). */
  studentNoPrefix: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{1,6}$/, 'Use 1–6 letters')
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
  const initials = name
    .normalize('NFKD')
    .split(/\s+/)
    .map((word) => word.replace(/[^A-Za-z]/g, '').charAt(0))
    .join('')
    .toUpperCase()
    .slice(0, 6);
  return initials.length > 0 ? initials : 'ST';
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
    const [tenant] = await tx
      .insert(tenants)
      .values({
        slug: data.slug,
        name: data.name,
        plan: data.plan,
        status: 'trial',
        studentNoPrefix: data.studentNoPrefix ?? defaultPrefix(data.name),
      })
      .returning({ id: tenants.id });
    if (!tenant) throw new Error('createTenant: tenant insert returned nothing');

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
