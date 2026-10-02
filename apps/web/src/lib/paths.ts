/**
 * Browser-facing paths (what the user sees in the address bar, before the proxy adds the
 * internal area prefix). Screen → route map: DESIGN.md §4.2–4.4.
 */
export const TENANT_PATHS = {
  home: '/',
  studentLogin: '/login',
  staffLogin: '/admin/login',
} as const;

export const PLATFORM_PATHS = {
  home: '/',
  login: '/login',
} as const;
