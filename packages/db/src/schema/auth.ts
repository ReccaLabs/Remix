import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  foreignKey,
  index,
  pgTable,
  text,
  unique,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { id, instant, tenantId, timestamps } from './columns';
import { tenants } from './tenants';
import { tenantUsers } from './users';

/** SHA-256 of a 256-bit random token, hex or base64url (ADR 0004). */
const hashLength = (column: AnyPgColumn) => sql`char_length(${column}) BETWEEN 32 AND 128`;

/**
 * A browser/device a user signed in from (2-device rule for students, AUTH-03). The device cookie
 * holds a random 256-bit id; only its hash is stored (ADR 0004).
 */
export const devices = pgTable(
  'devices',
  {
    id: id(),
    tenantId: tenantId().references(() => tenants.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').notNull(),
    tokenHash: text('token_hash').notNull(),
    /** Human label parsed from the user agent, e.g. "Chrome on Android". */
    label: text('label').notNull(),
    userAgent: text('user_agent'),
    firstSeenAt: instant('first_seen_at').notNull().defaultNow(),
    lastSeenAt: instant('last_seen_at').notNull().defaultNow(),
    signedOutAt: instant('signed_out_at'),
    /** Who signed the device out (the student, or staff). Null while active. */
    signedOutBy: uuid('signed_out_by'),
    ...timestamps(),
  },
  (t) => [
    foreignKey({
      name: 'devices_user_fk',
      columns: [t.tenantId, t.userId],
      foreignColumns: [tenantUsers.tenantId, tenantUsers.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'devices_signed_out_by_fk',
      columns: [t.tenantId, t.signedOutBy],
      foreignColumns: [tenantUsers.tenantId, tenantUsers.id],
    }),
    unique('devices_tenant_id_id_key').on(t.tenantId, t.id),
    unique('devices_tenant_token_hash_key').on(t.tenantId, t.tokenHash),
    index('devices_active_by_user_idx')
      .on(t.tenantId, t.userId)
      .where(sql`${t.signedOutAt} IS NULL`),
    check('devices_token_hash_length', hashLength(t.tokenHash)),
    check('devices_label_length', sql`char_length(${t.label}) BETWEEN 1 AND 120`),
    check('devices_user_agent_length', sql`char_length(${t.userAgent}) <= 512`),
  ],
);

/**
 * Opaque session tokens (ADR 0004). Only the SHA-256 of the token is stored; the token itself
 * lives in the cookie. Rotation moves `token_hash` to `prev_token_hash` (accepted for a short
 * grace after `rotated_at`); a later reuse of it revokes the whole `family_id`.
 */
export const sessions = pgTable(
  'sessions',
  {
    id: id(),
    tenantId: tenantId().references(() => tenants.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').notNull(),
    tokenHash: text('token_hash').notNull(),
    prevTokenHash: text('prev_token_hash'),
    familyId: uuid('family_id').notNull(),
    deviceId: uuid('device_id'),
    staySignedIn: boolean('stay_signed_in').notNull().default(false),
    rotatedAt: instant('rotated_at'),
    lastSeenAt: instant('last_seen_at').notNull().defaultNow(),
    /** Absolute expiry (12 h, or 30 days with "stay signed in"); never extended. */
    expiresAt: instant('expires_at').notNull(),
    revokedAt: instant('revoked_at'),
    revokedReason: text('revoked_reason'),
    /** Platform staff id when this is an impersonation session (no FK: platform tables are global). */
    impersonatedBy: uuid('impersonated_by'),
    ...timestamps(),
  },
  (t) => [
    foreignKey({
      name: 'sessions_user_fk',
      columns: [t.tenantId, t.userId],
      foreignColumns: [tenantUsers.tenantId, tenantUsers.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'sessions_device_fk',
      columns: [t.tenantId, t.deviceId],
      foreignColumns: [devices.tenantId, devices.id],
    }).onDelete('cascade'),
    unique('sessions_tenant_id_id_key').on(t.tenantId, t.id),
    // Lookups run inside the host tenant's withTenant(), so every key leads with tenant_id.
    unique('sessions_tenant_token_hash_key').on(t.tenantId, t.tokenHash),
    index('sessions_tenant_prev_token_hash_idx').on(t.tenantId, t.prevTokenHash),
    index('sessions_tenant_family_idx').on(t.tenantId, t.familyId),
    index('sessions_active_by_user_idx')
      .on(t.tenantId, t.userId)
      .where(sql`${t.revokedAt} IS NULL`),
    check('sessions_token_hash_length', hashLength(t.tokenHash)),
    check('sessions_prev_token_hash_length', hashLength(t.prevTokenHash)),
    check(
      'sessions_revoked_reason_needs_revoked_at',
      sql`${t.revokedReason} IS NULL OR ${t.revokedAt} IS NOT NULL`,
    ),
    check('sessions_expires_after_created', sql`${t.expiresAt} > ${t.createdAt}`),
  ],
);
