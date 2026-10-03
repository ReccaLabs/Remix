/**
 * Browser-facing paths (what the user sees in the address bar, before the proxy adds the
 * internal area prefix). Screen → route map: DESIGN.md §4.2–4.4.
 */
export const TENANT_PATHS = {
  home: '/',
  studentLogin: '/login',
  staffLogin: '/admin/login',
  /** AUTH-02/07/09 SMS-code flows (phone → code → new password). */
  studentForgot: '/login/forgot',
  studentFirst: '/login/first',
  studentUnlock: '/login/unlock',
  staffForgot: '/admin/login/forgot',
  staffUnlock: '/admin/login/unlock',
  /** AUTH-07 — the token travels only in the fragment: `/admin/invite#<token>`. */
  staffInvite: '/admin/invite',
} as const;

/** Student portal (DESIGN.md §4.2). Bottom tabs: Home · Classes · Pay · Live · Me. */
export const PORTAL_PATHS = {
  home: '/app',
  classes: '/app/classes',
  pay: '/app/pay',
  live: '/app/live',
  me: '/app/me',
} as const;

/** Institute admin (DESIGN.md §4.3). Phone tabs: Home · Students · Fees · Classes · More. */
export const ADMIN_PATHS = {
  home: '/admin',
  students: '/admin/students',
  fees: '/admin/fees',
  classes: '/admin/classes',
  more: '/admin/more',
} as const;

export const PLATFORM_PATHS = {
  home: '/',
  login: '/login',
} as const;
