'use client';

import { ErrorView } from '@/components/error-view';

export default function PlatformError(props: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return <ErrorView {...props} />;
}
