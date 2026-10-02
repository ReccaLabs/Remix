import { ShellTenant, ShellUser } from '@remix/ui';
import type { TenantPublic } from '@remix/types/api';
import { LogoutButton } from '@/components/auth/logout-button';
import { TenantTile } from '@/components/tenant/tenant-tile';
import { initials } from '@/lib/initials';

/** Name plus logo or initials for the UI kit's <ShellTenant> (sidebar, phone top bar). */
export function shellTenantProps(tenant: TenantPublic) {
  return {
    name: tenant.name,
    logo: tenant.logoUrl ? <TenantTile tenant={tenant} size="sm" /> : undefined,
    initials: initials(tenant.name),
  };
}

/**
 * Top bar of the portal and admin shells. Phones: the institute (the sidebar is hidden) and
 * Log out. From `lg`: Log out on the right, after the signed-in person when `user` is given
 * (admin, as in Institute Dashboard; the portal shows the person in its sidebar instead).
 */
export function ShellHeader({
  tenant,
  user,
  logoutTo,
}: {
  tenant: TenantPublic;
  user?: { name: string; meta: string };
  logoutTo: string;
}) {
  return (
    <>
      <ShellTenant {...shellTenantProps(tenant)} className="lg:hidden" />
      <div className="flex-1" />
      {user ? (
        <ShellUser
          name={user.name}
          meta={user.meta}
          initials={initials(user.name)}
          className="hidden lg:flex"
        />
      ) : null}
      <LogoutButton redirectTo={logoutTo} />
    </>
  );
}
