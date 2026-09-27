import { createNavigation } from 'next-intl/navigation';
import { routing } from './routing';

// Locale-aware Link/usePathname. Always use these instead of next/link in apps/site.
export const { Link, usePathname, useRouter, getPathname } = createNavigation(routing);
