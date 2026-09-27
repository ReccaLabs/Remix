import { Container, DisplayHeading, IconTile } from '@remix/ui';
import {
  FileText,
  Globe,
  Languages,
  ShieldCheck,
  Smartphone,
  Wallet,
  type LucideIcon,
} from 'lucide-react';
import { getTranslations } from 'next-intl/server';

const FEATURES: {
  key: 'website' | 'fees' | 'lessons' | 'devices' | 'tutes' | 'languages';
  icon: LucideIcon;
}[] = [
  { key: 'website', icon: Globe },
  { key: 'fees', icon: Wallet },
  { key: 'lessons', icon: ShieldCheck },
  { key: 'devices', icon: Smartphone },
  { key: 'tutes', icon: FileText },
  { key: 'languages', icon: Languages },
];

export async function TeacherFeatures() {
  const t = await getTranslations('teachers.features');

  return (
    <section aria-labelledby="teacher-features-title">
      <Container className="flex flex-col gap-12 py-16 sm:py-24">
        <DisplayHeading id="teacher-features-title" className="max-w-[640px]">
          {t('title')}
        </DisplayHeading>
        <ul className="m-0 grid list-none grid-cols-[repeat(auto-fit,minmax(min(300px,100%),1fr))] gap-x-12 gap-y-10 p-0">
          {FEATURES.map(({ key, icon: Icon }) => (
            <li key={key} className="flex gap-4">
              <IconTile>
                <Icon size={22} strokeWidth={1.75} />
              </IconTile>
              <div className="flex min-w-0 flex-col gap-1.5">
                <h3 className="m-0 text-[19px] font-semibold leading-[26px]">
                  {t(`items.${key}.title`)}
                </h3>
                <p className="text-muted m-0 text-pretty">{t(`items.${key}.body`)}</p>
              </div>
            </li>
          ))}
        </ul>
      </Container>
    </section>
  );
}
