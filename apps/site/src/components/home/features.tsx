import { Badge, Container, DisplayHeading, Eyebrow, IconTile } from '@remix/ui';
import {
  BellRing,
  Globe,
  Receipt,
  ScanLine,
  ShieldCheck,
  Video,
  type LucideIcon,
} from 'lucide-react';
import { getTranslations } from 'next-intl/server';

const FEATURES: {
  key: 'website' | 'fees' | 'video' | 'zoom' | 'gate' | 'parents';
  icon: LucideIcon;
  isNew?: boolean;
}[] = [
  { key: 'website', icon: Globe },
  { key: 'fees', icon: Receipt },
  { key: 'video', icon: ShieldCheck },
  { key: 'zoom', icon: Video },
  { key: 'gate', icon: ScanLine, isNew: true },
  { key: 'parents', icon: BellRing },
];

export async function Features() {
  const t = await getTranslations('home.features');

  return (
    <section id="features" aria-labelledby="features-title">
      <Container className="flex flex-col gap-12 py-16 sm:py-24">
        <div className="flex max-w-[680px] flex-col gap-3">
          <Eyebrow>{t('eyebrow')}</Eyebrow>
          <DisplayHeading id="features-title">{t('title')}</DisplayHeading>
        </div>
        <ul className="border-line-warm m-0 grid list-none grid-cols-[repeat(auto-fit,minmax(min(320px,100%),1fr))] border-l border-t p-0">
          {FEATURES.map(({ key, icon: Icon, isNew }) => (
            <li
              key={key}
              className="border-line-warm flex flex-col gap-3.5 border-b border-r p-6 sm:p-8"
            >
              <IconTile tone={isNew ? 'accent' : 'brand'}>
                <Icon size={22} strokeWidth={1.75} />
              </IconTile>
              <h3 className="m-0 flex items-center gap-2 text-[19px] font-semibold leading-[26px]">
                {t(`items.${key}.title`)}
                {isNew && <Badge>{t('newBadge')}</Badge>}
              </h3>
              <p className="text-muted m-0 text-pretty">{t(`items.${key}.body`)}</p>
            </li>
          ))}
        </ul>
      </Container>
    </section>
  );
}
