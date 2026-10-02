import { Container, Eyebrow } from '@remix/ui';
import { getTranslations } from 'next-intl/server';
import { getTenant } from '@/server/api';

// Placeholder that proves host routing; the page-builder site replaces it (DESIGN.md §4.2).
export default async function TenantHomePage() {
  const [tenant, t] = await Promise.all([getTenant(), getTranslations('tenant.site')]);
  return (
    <main id="main" className="py-16 sm:py-24">
      <Container className="flex flex-col gap-3">
        <Eyebrow>{t('eyebrow')}</Eyebrow>
        <h1 className="font-display m-0 text-balance text-4xl font-bold tracking-tight sm:text-5xl">
          {tenant.name}
        </h1>
        <p className="text-muted m-0 max-w-xl">{t('placeholder')}</p>
      </Container>
    </main>
  );
}
