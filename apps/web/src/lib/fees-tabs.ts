import { can } from '@remix/types';
import type { StaffRole } from '@remix/types/api';
import { FEES_TAB_IDS, type FeesTabId } from '@/components/fees/fees-tabs';

export const FEES_TAB_HREF: Record<FeesTabId, string> = {
  payments: '/admin/fees',
  invoices: '/admin/fees?tab=invoices',
  slips: '/admin/fees?tab=slips',
  cash: '/admin/fees?tab=cash',
};

/**
 * The Fees tabs a staff member may open, in display order. Mirrors the API (permissions.ts):
 * Payments, Invoices and the Bank slips queue need `fees.read`; the Cash counter also needs
 * `fees.collect`. The API enforces both; this only hides what would answer 403.
 */
export function allowedFeesTabs(roles: readonly StaffRole[]): FeesTabId[] {
  if (!can(roles, 'fees.read')) return [];
  return FEES_TAB_IDS.filter((id) => id !== 'cash' || can(roles, 'fees.collect'));
}

/** The requested `?tab=` when the user may open it, else the first tab (Payments). */
export function resolveFeesTab(
  requested: string | string[] | undefined,
  roles: readonly StaffRole[],
): FeesTabId {
  const value = Array.isArray(requested) ? requested[0] : requested;
  const allowed = allowedFeesTabs(roles);
  return allowed.find((id) => id === value) ?? 'payments';
}
