import type { StaffRole } from './api/auth';

/**
 * Staff permissions (STF-01/02). The API checks them in guards (deny by default) and the admin UI
 * uses the same table only to hide controls. Teachers are additionally limited to the classes in
 * their `classScope` (STF-02) — that filter is applied in queries, not here.
 */
export const PERMISSIONS = [
  'dashboard.view',
  'students.read',
  'students.write',
  'students.import',
  'students.devices',
  'classes.read',
  'classes.write',
  'enrollments.write',
  'staff.manage',
  'settings.manage',
  // Phase 3 - money (ADR 0008).
  'fees.read',
  'fees.collect',
  'fees.reverse',
  'fees.settings',
  'sms.send',
  'sms.wallet',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const ALL: readonly Permission[] = PERMISSIONS;
const OWNER_ONLY: readonly Permission[] = [
  'staff.manage',
  'settings.manage',
  'fees.reverse',
  'fees.settings',
  'sms.wallet',
];

export const ROLE_PERMISSIONS: Readonly<Record<StaffRole, readonly Permission[]>> = {
  owner: ALL,
  // Admins run the institute day to day but cannot change staff, settings or money rules, and
  // cannot reverse payments (FEE-11: owner only).
  admin: ALL.filter((p) => !OWNER_ONLY.includes(p)),
  teacher: ['dashboard.view', 'students.read', 'classes.read'],
  cashier: ['dashboard.view', 'students.read', 'classes.read', 'fees.read', 'fees.collect'],
  gatekeeper: ['students.read'],
};

/** True when any of the user's roles grants the permission. */
export function can(roles: readonly StaffRole[], permission: Permission): boolean {
  return roles.some((role) => ROLE_PERMISSIONS[role].includes(permission));
}

/** Roles whose data access is limited to their assigned classes (STF-02). */
export function isClassScoped(roles: readonly StaffRole[]): boolean {
  return roles.length > 0 && roles.every((role) => role === 'teacher');
}
