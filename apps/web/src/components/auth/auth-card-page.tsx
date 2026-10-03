import type { TenantPublic } from '@remix/types/api';
import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { PoweredBy } from '@/components/powered-by';
import { TenantTile } from '@/components/tenant/tenant-tile';

/**
 * Single-card page for the auth steps that are not the login form itself (SMS code flows,
 * invitation): institute tile, a card with title + intro + the client island, a way back.
 * Phone: full-width on the surface; tablet/desktop: a centred 420 px card on the canvas.
 */
export function AuthCardPage({
  tenant,
  area,
  title,
  intro,
  backHref,
  backLabel,
  children,
}: {
  tenant: TenantPublic;
  /** Small line under the institute name, e.g. "Admin". */
  area?: string;
  title: string;
  intro?: ReactNode;
  backHref?: string;
  backLabel?: string;
  children: ReactNode;
}) {
  return (
    <main
      id="main"
      className="bg-surface md:bg-canvas flex min-h-dvh flex-col items-center px-6 pb-8 pt-10 md:justify-center md:gap-6 md:px-4"
    >
      <div className="flex w-full max-w-[420px] flex-col gap-6 md:items-center">
        <div className="flex items-center gap-2.5">
          <TenantTile tenant={tenant} />
          <div className="flex flex-col">
            <span className="text-base font-semibold">{tenant.name}</span>
            {area ? <span className="text-muted text-xs">{area}</span> : null}
          </div>
        </div>

        <div className="md:bg-surface md:border-line md:rounded-card flex w-full flex-col gap-5 md:border md:p-7">
          <div className="flex flex-col gap-1">
            <h1 className="m-0 text-2xl font-semibold tracking-[-0.02em] md:text-[26px] md:leading-8">
              {title}
            </h1>
            {intro ? <p className="text-muted m-0">{intro}</p> : null}
          </div>
          {children}
          {backHref && backLabel ? (
            <Link
              href={backHref}
              className="text-ink-2 inline-flex min-h-11 items-center gap-1.5 self-start text-sm font-medium"
            >
              <ArrowLeft aria-hidden size={16} />
              {backLabel}
            </Link>
          ) : null}
        </div>
      </div>
      <PoweredBy className="mt-auto pt-8 md:mt-0 md:pt-0" />
    </main>
  );
}
