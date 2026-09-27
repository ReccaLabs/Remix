import type { ComponentPropsWithoutRef, ElementType, ReactNode } from 'react';
import { cn } from './cn';

/** Centered content column. `marketing` = 1200px (remix.lk), `app` = 1440px (admin). */
export function Container({
  width = 'marketing',
  className,
  ...props
}: ComponentPropsWithoutRef<'div'> & { width?: 'marketing' | 'app' }) {
  return (
    <div
      className={cn(
        'mx-auto w-full px-4 sm:px-6',
        width === 'marketing' ? 'max-w-marketing' : 'max-w-app',
        className,
      )}
      {...props}
    />
  );
}

/** Small blue label above a section title ("Everything in one place"). */
export function Eyebrow({ className, ...props }: ComponentPropsWithoutRef<'span'>) {
  return <span className={cn('text-brand text-sm font-semibold', className)} {...props} />;
}

type HeadingTag = 'h1' | 'h2' | 'h3';

/** Bricolage display heading. Sizes step down on small screens so Sinhala/Tamil still fit. */
export function DisplayHeading<T extends HeadingTag = 'h2'>({
  as,
  size = 'md',
  className,
  children,
  ...props
}: {
  as?: T;
  size?: 'md' | 'lg' | 'xl';
  className?: string;
  children: ReactNode;
} & Omit<ComponentPropsWithoutRef<T>, 'children' | 'className'>) {
  const Tag = (as ?? 'h2') as ElementType;
  const sizes = {
    md: 'text-[32px] leading-[1.08] tracking-[-0.03em] sm:text-[40px] lg:text-display font-bold',
    lg: 'text-[34px] leading-[1.06] tracking-[-0.035em] sm:text-[44px] lg:text-display-lg font-extrabold',
    xl: 'text-[40px] leading-[1.02] tracking-[-0.035em] sm:text-[54px] lg:text-display-xl font-extrabold',
  } as const;
  return (
    <Tag className={cn('font-display m-0 text-balance', sizes[size], className)} {...props}>
      {children}
    </Tag>
  );
}

/** Rounded 44px icon tile used in feature grids. Pass a Lucide icon as children. */
export function IconTile({
  tone = 'brand',
  className,
  children,
}: {
  tone?: 'brand' | 'accent';
  className?: string;
  children: ReactNode;
}) {
  return (
    <span
      aria-hidden
      className={cn(
        'flex size-11 flex-none items-center justify-center rounded-md',
        tone === 'brand' ? 'bg-brand-soft text-brand' : 'bg-accent-soft text-accent-ink',
        className,
      )}
    >
      {children}
    </span>
  );
}

/** Small pill badge ("New"). Status badges for the app live with the app components. */
export function Badge({
  tone = 'accent',
  className,
  ...props
}: ComponentPropsWithoutRef<'span'> & { tone?: 'accent' | 'brand' | 'ink' }) {
  const tones = {
    accent: 'bg-accent-soft text-accent-ink',
    brand: 'bg-brand-soft text-brand',
    ink: 'bg-ink text-white',
  } as const;
  return (
    <span
      className={cn(
        'rounded-xs inline-flex items-center px-1.5 text-[11px] font-semibold leading-[18px]',
        tones[tone],
        className,
      )}
      {...props}
    />
  );
}
