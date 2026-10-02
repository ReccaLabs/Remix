import { pgEnum } from 'drizzle-orm/pg-core';
import {
  CLASS_PLACES,
  LOCALES,
  MEDIUMS,
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

/** Local to the database: account state of a tenant user. */
export const USER_STATUSES = ['active', 'disabled', 'invited'] as const;
export type UserStatus = (typeof USER_STATUSES)[number];
export const userStatus = pgEnum('user_status', USER_STATUSES);

/** Who performed an audited action. `system` = jobs and provisioning CLIs. */
export const ACTOR_KINDS = ['student', 'staff', 'platform', 'system'] as const;
export type ActorKind = (typeof ACTOR_KINDS)[number];
export const actorKind = pgEnum('actor_kind', ACTOR_KINDS);
