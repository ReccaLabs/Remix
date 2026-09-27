import { Container, DisplayHeading, Eyebrow, IconTile } from '@remix/ui';
import { Globe, KeyRound, MessageSquare } from 'lucide-react';
import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { FindClassForm } from '@/components/find-class/find-class-form';
import { Link } from '@/i18n/navigation';
import { toLocale } from '@/i18n/routing';
import { pageMetadata } from '@/lib/seo';
import { ROUTES } from '@/lib/site';

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const locale = toLocale((await params).locale);
  const t = await getTranslations({ locale, namespace: 'demo.findClass.meta' });
  return pageMetadata({
    locale,
    path: ROUTES.findClass,
    title: t('title'),
    description: t('description'),
  });
}

const HELP = [
  { key: 'ask', Icon: MessageSquare },
  { key: 'ownDomain', Icon: Globe },
  { key: 'login', Icon: KeyRound },
] as const;

// Built from the brand. For students who reach remix.lk instead of their class's own site.
export default async function FindYourClassPage({ params }: Props) {
  const locale = toLocale((await params).locale);
  setRequestLocale(locale);
  const t = await getTranslations('demo.findClass');

  return (
    <Container className="flex flex-col gap-12 py-12 sm:py-16 lg:py-20">
      <div className="grid items-start gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,520px)] lg:gap-16">
        <div className="flex flex-col gap-4">
          <Eyebrow>{t('eyebrow')}</Eyebrow>
          <DisplayHeading as="h1" size="lg">
            {t('title')}
          </DisplayHeading>
          <p className="text-ink-2 m-0 max-w-[480px] text-pretty text-lg leading-7">{t('body')}</p>
        </div>
        <div className="border-line-warm bg-surface shadow-card rounded-card border p-5 sm:p-8">
          <FindClassForm />
        </div>
      </div>

      <ul className="m-0 grid list-none gap-4 p-0 md:grid-cols-3">
        {HELP.map(({ key, Icon }) => (
          <li
            key={key}
            className="border-line-warm bg-surface rounded-card flex flex-col gap-3 border p-6"
          >
            <IconTile>
              <Icon size={22} />
            </IconTile>
            <h2 className="m-0 text-lg font-semibold leading-6">{t(`help.${key}.title`)}</h2>
            <p className="text-ink-2 m-0 text-[15px] leading-6">{t(`help.${key}.body`)}</p>
          </li>
        ))}
      </ul>

      <p className="text-muted m-0 text-sm">
        {t.rich('teacher', {
          link: (chunks) => (
            <Link href={ROUTES.teachers} className="font-medium">
              {chunks}
            </Link>
          ),
        })}
      </p>
    </Container>
  );
}
