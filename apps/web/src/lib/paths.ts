/**
 * Browser-facing paths (what the user sees in the address bar, before the proxy adds the
 * internal area prefix). Screen → route map: DESIGN.md §4.2–4.4.
 */
export const TENANT_PATHS = {
  home: '/',
  studentLogin: '/login',
  staffLogin: '/admin/login',
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
