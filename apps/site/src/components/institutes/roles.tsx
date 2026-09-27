import { cn, Container } from '@remix/ui';
import { Building2, GraduationCap, Receipt, ScanLine, type LucideIcon } from 'lucide-react';
import { getTranslations } from 'next-intl/server';

const ROLES: {
  key: 'owner' | 'teacher' | 'cashier' | 'gatekeeper';
  icon: LucideIcon;
  tile: string;
}[] = [
  { key: 'owner', icon: Building2, tile: 'bg-ink text-white' },
  { key: 'teacher', icon: GraduationCap, tile: 'bg-brand-soft text-brand' },
  { key: 'cashier', icon: Receipt, tile: 'bg-accent-soft text-accent-ink' },
  { key: 'gatekeeper', icon: ScanLine, tile: 'bg-success-soft text-success-ink' },
];

/**
 * Four role cards in one bordered panel. The 1px gaps over a `line-warm` background draw the
 * dividers, so they stay correct at 1, 2 or 4 columns.
 */
export async function Roles() {
  const t = await getTranslations('institutes.roles');

  return (
    <section aria-labelledby="roles-title">
      <Container className="pb-16 sm:pb-24">
        <h2 id="roles-title" className="sr-only">
          {t('title')}
        </h2>
        <ul className="border-line-warm bg-line-warm rounded-card m-0 grid list-none grid-cols-1 gap-px overflow-hidden border p-0 sm:grid-cols-2 lg:grid-cols-4">
          {ROLES.map(({ key, icon: Icon, tile }) => (
            <li key={key} className="bg-surface flex flex-col gap-3 p-6 sm:p-7">
              <span
                aria-hidden
                className={cn('flex size-10 items-center justify-center rounded-md', tile)}
              >
                <Icon size={20} strokeWidth={1.75} />
              </span>
              <h3 className="m-0 text-[19px] font-semibold leading-[26px]">
                {t(`items.${key}.title`)}
              </h3>
              <p className="text-muted m-0 text-pretty">{t(`items.${key}.body`)}</p>
            </li>
          ))}
        </ul>
      </Container>
    </section>
  );
}
