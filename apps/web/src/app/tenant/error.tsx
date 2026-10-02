'use client';

import { ErrorView } from '@/components/error-view';

export default function TenantError(props: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return <ErrorView {...props} />;
}
