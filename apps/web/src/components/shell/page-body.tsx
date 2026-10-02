import { cn } from '@remix/ui';
import type { ReactNode } from 'react';

/** Content column inside the portal/admin shells: phone gutters 16 px, desktop 32–40 px. */
export function PageBody({
  children,
  className,
  width = 'portal',
}: {
  children: ReactNode;
  className?: string;
  width?: 'portal' | 'admin';
}) {
  return (
    <div
      className={cn(
        'mx-auto flex w-full flex-col gap-6 px-4 py-5',
        width === 'portal' ? 'max-w-6xl lg:px-10 lg:py-8' : 'max-w-app lg:px-8 lg:py-7',
        className,
      )}
    >
      {children}
    </div>
  );
}

/** Page title block: h1 + one quiet line under it. */
export function PageTitle({ title, subtitle }: { title: ReactNode; subtitle?: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <h1 className="m-0 text-[26px] font-semibold leading-8 tracking-[-0.02em] lg:text-2xl">
        {title}
      </h1>
      {subtitle ? <p className="text-muted m-0">{subtitle}</p> : null}
    </div>
  );
}
