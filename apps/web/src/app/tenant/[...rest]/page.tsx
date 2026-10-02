import { notFound } from 'next/navigation';

// Unmatched paths on an institute host render tenant/not-found.tsx inside the tenant layout
// (institute name and brand) instead of the bare global 404.
export default function CatchAll() {
  notFound();
}
