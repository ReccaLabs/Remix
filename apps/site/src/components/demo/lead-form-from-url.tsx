'use client';

import type { LeadIntent } from '@remix/types/lead';
import { useSearchParams } from 'next/navigation';
import { LeadForm } from './lead-form';

/**
 * Reads `?intent=trial` (ROUTES.trial) on the client. Static export can't read the query at build
 * time, so the page wraps this in <Suspense> with a demo-intent <LeadForm> as the fallback.
 */
export function LeadFormFromUrl({ whatsappHref }: { whatsappHref: string | null }) {
  const intent: LeadIntent = useSearchParams().get('intent') === 'trial' ? 'trial' : 'demo';
  return <LeadForm key={intent} initialIntent={intent} whatsappHref={whatsappHref} />;
}
