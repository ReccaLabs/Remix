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
  /** True when platform staff are signed in as this user (30 min, banner shown — PLT-04). */
  impersonated: z.boolean(),
});
export type SessionResponse = z.infer<typeof sessionResponseSchema>;

// ---------------------------------------------------------------------------------------------
// Phase 2 — SMS codes, device limit, 2-step, invites, "Me" (AUTH-02/03/04/05/07/08/09)
// ---------------------------------------------------------------------------------------------

/** Six digits, sent by SMS. Spaces are tolerated so a pasted "123 456" works. */
export const otpCodeSchema = z
  .string()
  .trim()
  .transform((v) => v.replace(/\s/g, ''))
  .pipe(z.string().regex(/^\d{6}$/, 'Enter the 6-digit code'));

/** AUTH-09 / AUTH-02 limits. The API enforces them; the UI shows the resend timer. */
export const OTP_RULES = {
  length: 6,
  ttlSeconds: 10 * 60,
  resendAfterSeconds: 45,
  /** At most 3 codes per phone per 15 minutes. */
  maxPerWindow: 3,
  windowSeconds: 15 * 60,
  /** Wrong guesses before a code is burnt. */
  maxAttempts: 5,
} as const;

export const LOGIN_LIMITS = {
  perPhonePerMinute: 5,
  perIpPerMinute: 20,
  /** Consecutive failures that lock an account until it is unlocked by SMS code. */
  lockoutAfterFailures: 10,
} as const;

/** Students may be signed in on this many devices at once (AUTH-03). */
export const STUDENT_DEVICE_LIMIT = 2;
/** "Trust this computer" skips staff 2-step for this long (AUTH-05). */
export const TRUSTED_DEVICE_DAYS = 30;
/** Staff invitation links expire after 72 h (AUTH-07). */
export const INVITE_TTL_HOURS = 72;

/**
 * - `password_reset` — forgot password (AUTH-02), also sent by an admin reset (AUTH-08).
 * - `first_password` — a student created by staff/import sets their first password (AUTH-07).
 * - `unlock` — clears a login lockout (AUTH-09).
 */
export const OTP_PURPOSES = ['password_reset', 'first_password', 'unlock'] as const;
export type OtpPurpose = (typeof OTP_PURPOSES)[number];

/**
 * Always answers 202 with the same body whether or not the phone has an account (no user
 * enumeration). Students and staff of this host are both looked up by phone.
 */
export const otpRequestSchema = z.strictObject({
  phone: sriLankaMobile,
  purpose: z.enum(OTP_PURPOSES),
});
export type OtpRequest = z.input<typeof otpRequestSchema>;

export const otpRequestResponseSchema = z.object({
  resendAfterSeconds: z.number().int().nonnegative(),
});

export const otpVerifySchema = z.strictObject({
  phone: sriLankaMobile,
  purpose: z.enum(OTP_PURPOSES),
  code: otpCodeSchema,
});
export type OtpVerify = z.input<typeof otpVerifySchema>;

/**
 * For password purposes: a one-time ticket (10 min) to pass to `setPassword`. For `unlock`:
 * the lockout is already cleared and `ticket` is null. Wrong code → 400 CODE_INVALID.
 */
export const otpVerifyResponseSchema = z.object({ ticket: z.string().min(32).max(256).nullable() });

/** Sets the password, revokes every existing session of the user, and does not sign in. */
export const setPasswordSchema = z.strictObject({
  ticket: z.string().min(32).max(256),
  newPassword: newPasswordSchema,
});
export type SetPasswordRequest = z.input<typeof setPasswordSchema>;

export const deviceSchema = z.object({
  id: z.uuid(),
  label: z.string(),
  firstSeenAt: z.iso.datetime({ offset: true }),
  lastSeenAt: z.iso.datetime({ offset: true }),
  /** The device making this request. */
  current: z.boolean(),
});
export type Device = z.infer<typeof deviceSchema>;

export const devicesResponseSchema = z.object({
  items: z.array(deviceSchema),
  /** Null for staff (no limit). */
  limit: z.number().int().positive().nullable(),
});
export type DevicesResponse = z.infer<typeof devicesResponseSchema>;

/**
 * AUTH-03 — carried in the `challenge` member of a 403 DEVICE_LIMIT problem from student login.
 * The token (5 min, single use) proves the password was correct; it does not grant access.
 */
export const deviceLimitChallengeSchema = z.object({
  token: z.string().min(32).max(256),
  devices: z.array(deviceSchema.omit({ current: true })),
  expiresAt: z.iso.datetime({ offset: true }),
});
export type DeviceLimitChallenge = z.infer<typeof deviceLimitChallengeSchema>;

/** Sign one device out and finish the login on this one. */
export const resolveDeviceLimitSchema = z.strictObject({
  token: z.string().min(32).max(256),
  signOutDeviceId: z.uuid(),
});
export type ResolveDeviceLimitRequest = z.input<typeof resolveDeviceLimitSchema>;

/** Roles that must pass the SMS 2-step on an untrusted computer (AUTH-05). */
export const TWO_STEP_ROLES = ['owner', 'admin', 'cashier'] as const satisfies readonly StaffRole[];

/**
 * AUTH-05 — carried in the `challenge` member of a 401 TWO_STEP_REQUIRED problem from staff
 * login. The SMS code has already been sent.
 */
export const twoStepChallengeSchema = z.object({
  token: z.string().min(32).max(256),
  /** e.g. "+94 77 *** **67". */
  maskedPhone: z.string(),
  resendAfterSeconds: z.number().int().nonnegative(),
  expiresAt: z.iso.datetime({ offset: true }),
});
export type TwoStepChallenge = z.infer<typeof twoStepChallengeSchema>;

export const twoStepVerifySchema = z.strictObject({
  token: z.string().min(32).max(256),
  code: otpCodeSchema,
  /** Sets a 30-day trusted-device cookie for this user on this host. */
  trustDevice: z.boolean().default(false),
});
export type TwoStepVerifyRequest = z.input<typeof twoStepVerifySchema>;

export const twoStepResendSchema = z.strictObject({ token: z.string().min(32).max(256) });

/** AUTH-07 — public preview of an invitation, before the invitee sets a password. */
export const invitePreviewSchema = z.object({
  tenantName: z.string(),
  displayName: z.string(),
  role: z.enum(STAFF_ROLES),
  expiresAt: z.iso.datetime({ offset: true }),
});
export type InvitePreview = z.infer<typeof invitePreviewSchema>;

/** The raw token from the invite link (`/admin/invite#<token>`; kept out of server logs). */
export const inviteTokenSchema = z.strictObject({ token: z.string().min(32).max(256) });

export const acceptInviteSchema = z.strictObject({
  token: z.string().min(32).max(256),
  newPassword: newPasswordSchema,
});
export type AcceptInviteRequest = z.input<typeof acceptInviteSchema>;

/** AUTH-04 — change password while signed in. Revokes the user's other sessions. */
export const changePasswordSchema = z.strictObject({
  currentPassword: loginPassword,
  newPassword: newPasswordSchema,
});
export type ChangePasswordRequest = z.input<typeof changePasswordSchema>;

export const updateMeSchema = z.strictObject({ locale: z.enum(LOCALES) });
export type UpdateMeRequest = z.input<typeof updateMeSchema>;
