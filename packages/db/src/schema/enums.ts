import { pgEnum } from 'drizzle-orm/pg-core';
import {
  CLASS_PLACES,
  LOCALES,
  MEDIUMS,
  OTP_PURPOSES,
  PLAN_IDS,
  STAFF_ROLES,
  TENANT_STATUSES,
  USER_KINDS,
} from '@remix/types';

/**
 * Postgres enums mirror the shared `@remix/types` constants, so the database rejects any value the
 * API contract does not know. Appending a value to a constant → `pnpm db:generate` emits
 * `ALTER TYPE … ADD VALUE`. Removing one needs a hand-written migration.
 */
export const tenantStatus = pgEnum('tenant_status', TENANT_STATUSES);
export const planId = pgEnum('plan_id', PLAN_IDS);
export const appLocale = pgEnum('app_locale', LOCALES);
export const userKind = pgEnum('user_kind', USER_KINDS);
export const staffRole = pgEnum('staff_role', STAFF_ROLES);
export const medium = pgEnum('medium', MEDIUMS);
export const classPlace = pgEnum('class_place', CLASS_PLACES);
export const otpPurpose = pgEnum('otp_purpose', OTP_PURPOSES);

/** Local to the database: account state of a tenant user. */
export const USER_STATUSES = ['active', 'disabled', 'invited'] as const;
export type UserStatus = (typeof USER_STATUSES)[number];
export const userStatus = pgEnum('user_status', USER_STATUSES);

/** Who performed an audited action. `system` = jobs and provisioning CLIs. */
export const ACTOR_KINDS = ['student', 'staff', 'platform', 'system'] as const;
export type ActorKind = (typeof ACTOR_KINDS)[number];
export const actorKind = pgEnum('actor_kind', ACTOR_KINDS);

/**
 * Local to the database: what an `auth_tickets` row proves (ADR 0004 addendum).
 * - `device_limit` — the password was right but the student is on 2 devices (AUTH-03, 5 min).
 * - `two_step` — the password was right; an SMS code is still owed (AUTH-05, 10 min).
 * - `password` — an SMS code was verified; the holder may set a new password (AUTH-02/07, 10 min).
 */
export const AUTH_TICKET_KINDS = ['device_limit', 'two_step', 'password'] as const;
export type AuthTicketKind = (typeof AUTH_TICKET_KINDS)[number];
export const authTicketKind = pgEnum('auth_ticket_kind', AUTH_TICKET_KINDS);
