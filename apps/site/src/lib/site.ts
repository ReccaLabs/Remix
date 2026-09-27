/**
 * Site-wide constants for remix.lk. Paths are locale-less; pass them to the
 * locale-aware <Link> from '@/i18n/navigation', which adds /en/ etc.
 */
export const SITE = {
  name: 'ReMix',
  company: 'Recca Labs',
  url: 'https://remix.lk',
  city: 'Colombo',
  country: 'LK',
  email: {
    hello: 'hello@remix.lk',
    sales: 'sales@remix.lk',
    security: 'security@remix.lk',
  },
  foundedYear: 2026,
} as const;

export const ROUTES = {
  home: '/',
  features: '/#features',
  pricing: '/pricing',
  teachers: '/for-teachers',
  institutes: '/for-institutes',
  guides: '/guides',
  about: '/about',
  demo: '/demo',
  trial: '/demo?intent=trial',
  findClass: '/find-your-class',
  privacy: '/privacy',
  terms: '/terms',
  dataProtection: '/data-protection',
} as const;

export type RouteKey = keyof typeof ROUTES;

/** WhatsApp deep link, or null when no number is configured (callers fall back to /demo). */
export function whatsappUrl(text?: string): string | null {
  const n = process.env.NEXT_PUBLIC_WHATSAPP_NUMBER?.replace(/\D/g, '');
  if (!n) return null;
  return `https://wa.me/${n}${text ? `?text=${encodeURIComponent(text)}` : ''}`;
}
