import 'server-only';
import type { StaffRole } from '@remix/types/api';
import { getFormatter, getTranslations } from 'next-intl/server';

/** "Owner and Teacher" — the signed-in staff member's roles as one localised phrase. */
export async function formatRoles(roles: readonly StaffRole[]): Promise<string> {
  const [t, format] = await Promise.all([getTranslations('admin.roles'), getFormatter()]);
  return format.list(
    roles.map((role) => t(role)),
    { type: 'conjunction' },
  );
}
