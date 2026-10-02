import type { ComponentType, ReactNode } from 'react';

/** Props the UI kit passes to links. Next.js `Link` (and next-intl's) accept all of them. */
export interface LinkLikeProps {
  href: string;
  className?: string;
  children?: ReactNode;
  'aria-current'?: 'page';
  tabIndex?: number;
}

/**
 * The router's link component. `@remix/ui` never imports Next.js: apps pass their `Link`
 * (`linkComponent={Link}`); the default is a plain `<a>`.
 */
export type LinkComponent = ComponentType<LinkLikeProps> | 'a';
