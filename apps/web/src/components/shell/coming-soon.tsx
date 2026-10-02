import { EmptyState, buttonClass } from '@remix/ui';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { PageBody, PageTitle } from './page-body';

/** Placeholder for a shell section that a later phase builds: what's coming + a way back. */
export function ComingSoon({
  title,
  heading,
  description,
  icon,
  backHref,
  backLabel,
  width,
  children,
}: {
  /** Page title (h1), e.g. "Pay". */
  title: string;
  /** "Coming soon". */
  heading: string;
  description: string;
  icon: ReactNode;
  backHref: string;
  backLabel: string;
  width?: 'portal' | 'admin';
  /** Extra content under the panel (e.g. account details on "Me"/"More"). */
  children?: ReactNode;
}) {
  return (
    <PageBody width={width}>
      <PageTitle title={title} />
      {children}
      <EmptyState
        className="bg-surface border-line rounded-lg border"
        icon={icon}
        title={heading}
        description={description}
        action={
          <Link href={backHref} className={buttonClass({ variant: 'secondary', size: 'lg' })}>
            {backLabel}
          </Link>
        }
      />
    </PageBody>
  );
}
