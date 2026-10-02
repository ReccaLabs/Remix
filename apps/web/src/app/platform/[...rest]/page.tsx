import { notFound } from 'next/navigation';

// Unmatched paths on the platform host render platform/not-found.tsx inside the platform layout.
export default function CatchAll() {
  notFound();
}
