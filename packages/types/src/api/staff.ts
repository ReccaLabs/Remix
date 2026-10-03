import { z } from 'zod';
import { sriLankaMobile } from '../phone';
import { STAFF_ROLES } from './auth';
import { isoDateTime, personName } from './common';

/**
 * STF-01 — invite a staff member. A phone is required for roles that need SMS 2-step
 * (owner, admin, cashier — AUTH-05); teachers and gatekeepers may be invited by email only.
 */
export const inviteStaffSchema = z
  .strictObject({
    displayName: personName,
    phone: sriLankaMobile.optional(),
    email: z.email().max(254).toLowerCase().optional(),
    role: z.enum(STAFF_ROLES),
    /** STF-02 — teacher's classes. Ignored for other roles. */
    classScope: z.array(z.uuid()).max(100).default([]),
  })
  .refine((s) => s.phone !== undefined || s.email !== undefined, {
    message: 'Enter a phone number or an email address',
    path: ['phone'],
  })
  .refine((s) => !['owner', 'admin', 'cashier'].includes(s.role) || s.phone !== undefined, {
    message: 'This role signs in with an SMS code, so a phone number is required',
    path: ['phone'],
  });
export type InviteStaffRequest = z.input<typeof inviteStaffSchema>;

export const STAFF_MEMBER_STATUSES = ['active', 'invited', 'disabled'] as const;

export const staffMemberSchema = z.object({
  /** User id for members; invitation id for pending invites. */
  id: z.uuid(),
  displayName: z.string(),
  phone: z.string().nullable(),
  email: z.string().nullable(),
  roles: z.array(z.enum(STAFF_ROLES)),
  classScope: z.array(z.uuid()),
  status: z.enum(STAFF_MEMBER_STATUSES),
  /** Pending invitations only. */
  inviteExpiresAt: isoDateTime.nullable(),
  lastSignInAt: isoDateTime.nullable(),
});
export type StaffMember = z.infer<typeof staffMemberSchema>;

/** STF-03 — usage against `PLAN_LIMITS` (null limit = unlimited). Invites count as seats. */
export const staffResponseSchema = z.object({
  items: z.array(staffMemberSchema),
  usage: z.object({
    teachers: z.object({ used: z.number().int(), limit: z.number().int().nullable() }),
    cashiers: z.object({ used: z.number().int(), limit: z.number().int().nullable() }),
  }),
});
export type StaffResponse = z.infer<typeof staffResponseSchema>;

/** Change role/scope or disable. The last active owner can never be demoted or disabled. */
export const updateStaffSchema = z
  .strictObject({
    role: z.enum(STAFF_ROLES).optional(),
    classScope: z.array(z.uuid()).max(100).optional(),
    status: z.enum(['active', 'disabled']).optional(),
  })
  .refine((s) => Object.keys(s).length > 0, 'Nothing to update');
export type UpdateStaffRequest = z.input<typeof updateStaffSchema>;
