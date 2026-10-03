import { sql } from 'drizzle-orm';
import { check, foreignKey, index, pgTable, text, unique, uuid } from 'drizzle-orm/pg-core';
import { id, instant, tenantId, timestamps } from './columns';
import { staffRole } from './enums';
import { tenants } from './tenants';
import { tenantUsers } from './users';

/**
 * STF-01 / AUTH-07 — a pending staff invitation. Only the SHA-256 of the 256-bit token is stored;
 * the raw token goes to the invitee's SMS/email and nowhere else. Expires after 72 h.
 *
 * Shape agreed with track P2-B (people), which owns this table; whichever branch merges second
 * keeps one definition.
 */
export const staffInvites = pgTable(
  'staff_invites',
  {
    id: id(),
    tenantId: tenantId().references(() => tenants.id, { onDelete: 'cascade' }),
    displayName: text('display_name').notNull(),
    phone: text('phone'),
    email: text('email'),
    role: staffRole('role').notNull(),
    /** STF-02 — teacher's classes (null/empty = none for non-teachers). */
    classScope: uuid('class_scope').array(),
    tokenHash: text('token_hash').notNull(),
    invitedBy: uuid('invited_by').notNull(),
    expiresAt: instant('expires_at').notNull(),
    acceptedAt: instant('accepted_at'),
    acceptedUserId: uuid('accepted_user_id'),
    revokedAt: instant('revoked_at'),
    ...timestamps(),
  },
  (t) => [
    foreignKey({
      name: 'staff_invites_invited_by_fk',
      columns: [t.tenantId, t.invitedBy],
      foreignColumns: [tenantUsers.tenantId, tenantUsers.id],
    }),
    foreignKey({
      name: 'staff_invites_accepted_user_fk',
      columns: [t.tenantId, t.acceptedUserId],
      foreignColumns: [tenantUsers.tenantId, tenantUsers.id],
    }),
    unique('staff_invites_tenant_id_id_key').on(t.tenantId, t.id),
    unique('staff_invites_tenant_token_hash_key').on(t.tenantId, t.tokenHash),
    index('staff_invites_pending_idx')
      .on(t.tenantId, t.expiresAt)
      .where(sql`${t.acceptedAt} IS NULL AND ${t.revokedAt} IS NULL`),
    check('staff_invites_token_hash_length', sql`char_length(${t.tokenHash}) BETWEEN 32 AND 128`),
    check(
      'staff_invites_display_name_length',
      sql`char_length(${t.displayName}) BETWEEN 1 AND 120`,
    ),
    check('staff_invites_phone_e164', sql`${t.phone} ~ '^[+][1-9][0-9]{7,14}$'`),
    check('staff_invites_has_contact', sql`${t.phone} IS NOT NULL OR ${t.email} IS NOT NULL`),
    check('staff_invites_expires_after_created', sql`${t.expiresAt} > ${t.createdAt}`),
    check(
      'staff_invites_accepted_has_user',
      sql`${t.acceptedAt} IS NULL OR ${t.acceptedUserId} IS NOT NULL`,
    ),
  ],
);
