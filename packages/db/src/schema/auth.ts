import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  foreignKey,
  index,
  pgTable,
  smallint,
  text,
  unique,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { id, instant, tenantId, timestamps } from './columns';
import { authTicketKind, otpPurpose } from './enums';
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
    /**
     * Staff "trust this computer" (AUTH-05): SHA-256 of the separate trust cookie and when the
     * trust ends (30 days). Cleared by sign-out and by any password change or reset.
     */
    trustTokenHash: text('trust_token_hash'),
    trustedUntil: instant('trusted_until'),
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
    unique('devices_tenant_trust_token_hash_key').on(t.tenantId, t.trustTokenHash),
    check('devices_token_hash_length', hashLength(t.tokenHash)),
    check('devices_trust_token_hash_length', hashLength(t.trustTokenHash)),
    check(
      'devices_trust_pair',
      sql`(${t.trustTokenHash} IS NULL) = (${t.trustedUntil} IS NULL)`,
    ),
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

/**
 * SMS one-time codes (AUTH-02/07/09, ADR 0004 addendum). A row is written for every accepted
 * request — also for phones without an account (`user_id` null, nothing sent) — so the work and
 * the timing do not depend on whether the phone exists. Only
 * `HMAC-SHA-256(server secret, tenant | phone | purpose | code)` is stored. A newer code for the
 * same phone and purpose, a correct guess and the last allowed wrong guess all set `consumed_at`.
 */
export const otpChallenges = pgTable(
  'otp_challenges',
  {
    id: id(),
    tenantId: tenantId().references(() => tenants.id, { onDelete: 'cascade' }),
    /** E.164 Sri Lankan mobile (`+947XXXXXXXX`), the only numbers that receive codes. */
    phone: text('phone').notNull(),
    /** The account the code was sent to; null when the phone has none (no SMS was sent). */
    userId: uuid('user_id'),
    purpose: otpPurpose('purpose').notNull(),
    codeHash: text('code_hash').notNull(),
    attempts: smallint('attempts').notNull().default(0),
    expiresAt: instant('expires_at').notNull(),
    consumedAt: instant('consumed_at'),
    ...timestamps(),
  },
  (t) => [
    foreignKey({
      name: 'otp_challenges_user_fk',
      columns: [t.tenantId, t.userId],
      foreignColumns: [tenantUsers.tenantId, tenantUsers.id],
    }).onDelete('cascade'),
    unique('otp_challenges_tenant_id_id_key').on(t.tenantId, t.id),
    index('otp_challenges_open_idx')
      .on(t.tenantId, t.phone, t.purpose)
      .where(sql`${t.consumedAt} IS NULL`),
    check('otp_challenges_phone_lk_mobile', sql`${t.phone} ~ '^[+]947[0-9]{8}$'`),
    check('otp_challenges_code_hash_length', hashLength(t.codeHash)),
    check('otp_challenges_attempts_range', sql`${t.attempts} BETWEEN 0 AND 100`),
    check('otp_challenges_expires_after_created', sql`${t.expiresAt} > ${t.createdAt}`),
  ],
);

/**
 * Short-lived, single-use bearer tickets between two steps of a sign-in (see `AUTH_TICKET_KINDS`).
 * The raw ticket (256 random bits) goes to the browser once; only its SHA-256 is stored. A ticket
 * is spent by one conditional UPDATE (`consumed_at IS NULL`), so it cannot be used twice even by
 * concurrent requests. Two-step tickets also carry the HMAC of the SMS code they wait for.
 */
export const authTickets = pgTable(
  'auth_tickets',
  {
    id: id(),
    tenantId: tenantId().references(() => tenants.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').notNull(),
    kind: authTicketKind('kind').notNull(),
    tokenHash: text('token_hash').notNull(),
    /** `password` tickets: which code purpose they came from (`password_reset`/`first_password`). */
    purpose: otpPurpose('purpose'),
    /** `two_step` tickets: HMAC of the SMS code, wrong guesses so far, last send. */
    codeHash: text('code_hash'),
    attempts: smallint('attempts').notNull().default(0),
    sends: smallint('sends').notNull().default(0),
    lastSentAt: instant('last_sent_at'),
    /** Carried from the login form to the session the ticket finally creates. */
    staySignedIn: boolean('stay_signed_in').notNull().default(false),
    expiresAt: instant('expires_at').notNull(),
    consumedAt: instant('consumed_at'),
    ...timestamps(),
  },
  (t) => [
    foreignKey({
      name: 'auth_tickets_user_fk',
      columns: [t.tenantId, t.userId],
      foreignColumns: [tenantUsers.tenantId, tenantUsers.id],
    }).onDelete('cascade'),
    unique('auth_tickets_tenant_id_id_key').on(t.tenantId, t.id),
    unique('auth_tickets_tenant_token_hash_key').on(t.tenantId, t.tokenHash),
    check('auth_tickets_token_hash_length', hashLength(t.tokenHash)),
    check('auth_tickets_code_hash_length', hashLength(t.codeHash)),
    check(
      'auth_tickets_two_step_has_code',
      sql`(${t.kind} = 'two_step') = (${t.codeHash} IS NOT NULL)`,
    ),
    check(
      'auth_tickets_password_has_purpose',
      sql`(${t.kind} = 'password') = (${t.purpose} IS NOT NULL)`,
    ),
    check('auth_tickets_attempts_range', sql`${t.attempts} BETWEEN 0 AND 100`),
    check('auth_tickets_sends_range', sql`${t.sends} BETWEEN 0 AND 100`),
    check('auth_tickets_expires_after_created', sql`${t.expiresAt} > ${t.createdAt}`),
  ],
);
