import type { DevicesResponse } from '@remix/types/api';
import { ShellUser } from '@remix/ui';
import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import { LogoutButton } from '@/components/auth/logout-button';
import { IntlIsland } from '@/components/intl-island';
import { ChangePasswordForm } from '@/components/portal/change-password-form';
import { LanguagePicker } from '@/components/portal/language-picker';
import { MeDevices } from '@/components/portal/me-devices';
import { PageBody, PageTitle } from '@/components/shell/page-body';
import { initials } from '@/lib/initials';
import { TENANT_PATHS } from '@/lib/paths';
import { getApi, requireStudent } from '@/server/api';
import { portalMetadata } from '@/server/metadata';

/**
 * Student "Me" (AUTH-04, Student Me 16a phone / 16b desktop): signed-in devices with sign-out,
 * change password, language, log out. Profile, gate QR and parent details join with STU-05.
 */

export const generateMetadata = () => portalMetadata('me');

function Section({ title, children }: { title: string; children: ReactNode }) {
  const id = `me-${title.toLowerCase().replace(/\W+/g, '-')}`;
  return (
    <section
      aria-labelledby={id}
      className="bg-surface border-line rounded-card flex flex-col gap-4 border p-4 lg:p-6"
    >
      <h2 id={id} className="m-0 text-base font-semibold">
        {title}
      </h2>
      {children}
    </section>
  );
}

export default async function MePage() {
  const session = await requireStudent();
  const t = await getTranslations('portal');
  const name = session.user.displayName;

  let devices: DevicesResponse | null = null;
  try {
    devices = await (await getApi()).call('myDevices');
  } catch {
    devices = null;
  }

  return (
    <PageBody>
      <PageTitle title={t('me.title')} />
      <div className="bg-surface border-line flex flex-wrap items-center justify-between gap-3 rounded-lg border p-4">
        <ShellUser name={name} meta={t('shell.student')} initials={initials(name)} />
        <LogoutButton redirectTo={TENANT_PATHS.studentLogin} />
      </div>
      <IntlIsland namespaces={['portal', 'auth']}>
        <div className="grid gap-5 lg:grid-cols-2 lg:items-start">
          <div className="flex flex-col gap-5">
            <Section title={t('me.devicesTitle')}>
              {devices ? (
                <MeDevices initial={devices.items} limit={devices.limit} />
              ) : (
                <p className="text-muted m-0 text-sm" role="alert">
                  {t('me.devicesLoadFailed')}
                </p>
              )}
            </Section>
            <Section title={t('me.languageTitle')}>
              <LanguagePicker initial={session.user.locale} />
            </Section>
          </div>
          <Section title={t('me.passwordTitle')}>
            <ChangePasswordForm />
          </Section>
        </div>
      </IntlIsland>
    </PageBody>
  );
}
