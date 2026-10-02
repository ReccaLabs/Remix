import { cn } from '@remix/ui';
import type { TenantPublic } from '@remix/types/api';
import { initials } from '@/lib/initials';

const sizes = {
  sm: 'size-8 rounded-[9px] text-[13px]',
  md: 'size-10 rounded-[11px] text-[15px]',
  lg: 'size-14 rounded-lg text-xl',
} as const;

/**
 * The institute's logo, or its initials on a brand-colour tile ("KP"). Decorative: the name is
 * always written next to it. `inverse` = white tile with brand letters, for brand-colour panels.
 */
export function TenantTile({
  tenant,
  size = 'md',
  inverse = false,
  className,
}: {
  tenant: Pick<TenantPublic, 'name' | 'logoUrl'>;
  size?: keyof typeof sizes;
  inverse?: boolean;
  className?: string;
}) {
  const frame = cn(
    'flex flex-none items-center justify-center overflow-hidden font-bold tracking-[-0.02em]',
    sizes[size],
    className,
  );
  if (tenant.logoUrl) {
    return (
      // A tenant upload of unknown size: next/image would need every logo host configured.
      // eslint-disable-next-line @next/next/no-img-element
      <img src={tenant.logoUrl} alt="" className={cn(frame, 'bg-surface object-contain')} />
    );
  }
  return (
    <span
      aria-hidden
      className={cn(frame, inverse ? 'bg-surface text-brand' : 'bg-brand text-white')}
    >
      {initials(tenant.name)}
    </span>
  );
}
