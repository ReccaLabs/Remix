import { Container, Logo } from '@remix/ui';
import { getTranslations } from 'next-intl/server';

// Placeholder that proves host routing; the overview replaces it (DESIGN.md §4.4).
export default async function PlatformHomePage() {
  const [t, a11y] = await Promise.all([
    getTranslations('platform.home'),
    getTranslations('common.a11y'),
  ]);
  return (
    <main id="main" className="py-16 sm:py-24">
      <Container width="app" className="flex flex-col gap-4">
        <Logo size={28} label={a11y('remix')} />
        <h1 className="font-display m-0 text-4xl font-bold tracking-tight">{t('title')}</h1>
        <p className="text-muted m-0 max-w-xl">{t('placeholder')}</p>
      </Container>
    </main>
  );
}
