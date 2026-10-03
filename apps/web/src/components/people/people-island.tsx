import type { ReactNode } from 'react';
import { IntlIsland } from '@/components/intl-island';
import type { Namespace } from '@/i18n/messages';
import { ToastBoundary } from './toast-boundary';

/**
 * Wraps the interactive part of a people page: the message namespaces its client components use
 * plus the toast area ("Archived 3 students"). `common` is always included for the toast labels.
 */
export function PeopleIsland({
  namespaces,
  children,
}: {
  namespaces: readonly Namespace[];
  children: ReactNode;
}) {
  return (
    <IntlIsland namespaces={['common', ...namespaces]}>
      <ToastBoundary>{children}</ToastBoundary>
    </IntlIsland>
  );
}
