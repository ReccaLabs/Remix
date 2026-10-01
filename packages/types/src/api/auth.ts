import { z } from 'zod';
import { sriLankaMobile } from '../phone';
import { LOCALES } from './tenant';

export const USER_KINDS = ['student', 'staff'] as const;
export type UserKind = (typeof USER_KINDS)[number];

/** Institute staff roles (01-product.md §2). Platform staff are a separate identity. */
export const STAFF_ROLES = ['owner', 'admin', 'teacher', 'cashier', 'gatekeeper'] as const;
export type StaffRole = (typeof STAFF_ROLES)[number];

export const PASSWORD_LIMITS = { min: 8, max: 128 } as const;

/**
 * Password policy for setting/changing a password. The upper bound caps hashing cost.
 * The common/breached-password check runs server-side (AUTH-09).
 */
export const newPasswordSchema = z.string().min(PASSWORD_LIMITS.min).max(PASSWORD_LIMITS.max);

/** At login only the bounds are checked — never reveal policy details for an existing password. */
const loginPassword = z.string().min(1).max(PASSWORD_LIMITS.max);

/** AUTH-01 — student login on the institute's own host. */
export const studentLoginRequestSchema = z.strictObject({
  phone: sriLankaMobile,
  password: loginPassword,
  staySignedIn: z.boolean().default(false),
});
export type StudentLoginRequest = z.input<typeof studentLoginRequestSchema>;

/** AUTH-05 — staff log in with a phone number or an email address. */
export const staffLoginRequestSchema = z.strictObject({
  identifier: z.string().trim().min(3).max(254),
  password: loginPassword,
  staySignedIn: z.boolean().default(false),
});
export type StaffLoginRequest = z.input<typeof staffLoginRequestSchema>;

export type StaffIdentifier = { kind: 'phone'; phone: string } | { kind: 'email'; email: string };

/** Decide whether a staff login identifier is a Sri Lankan mobile or an email (lower-cased). */
export function parseStaffIdentifier(identifier: string): StaffIdentifier | null {
  const phone = sriLankaMobile.safeParse(identifier);
  if (phone.success) return { kind: 'phone', phone: phone.data };
  const email = z.email().safeParse(identifier.trim().toLowerCase());
  return email.success ? { kind: 'email', email: email.data } : null;
}

export const sessionUserSchema = z.object({
  id: z.uuid(),
  tenantId: z.uuid(),
  kind: z.enum(USER_KINDS),
  displayName: z.string(),
  /** Empty for students. */
  roles: z.array(z.enum(STAFF_ROLES)),
  locale: z.enum(LOCALES),
});
export type SessionUser = z.infer<typeof sessionUserSchema>;

/** Response of login and GET /auth/session. The session token itself is only ever in a cookie. */
export const sessionResponseSchema = z.object({
  user: sessionUserSchema,
  expiresAt: z.iso.datetime({ offset: true }),
});
export type SessionResponse = z.infer<typeof sessionResponseSchema>;
