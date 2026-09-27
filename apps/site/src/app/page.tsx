import { redirect } from 'next/navigation';
import { routing } from '@/i18n/routing';

// In production Cloudflare serves public/_redirects (`/ → /en/`, 302) before this page is hit.
// This keeps `next dev` and any other static host working too.
export default function RootPage() {
  redirect(`/${routing.defaultLocale}/`);
}
