'use client';

import { Button, StatusBadge } from '@remix/ui';
import type { Device } from '@remix/types/api';
import { Laptop } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import { FormAlert } from '@/components/form-alert';
import { createBrowserApi } from '@/lib/browser-api';
import { formatLastUsed } from '@/lib/device-time';

/**
 * AUTH-04 (Student Me 16a/b): the student's signed-in devices, this one marked, the others
 * with "Sign out" (their sessions end at once). "This device" leaves through Log out.
 */
export function MeDevices({ initial, limit }: { initial: Device[]; limit: number | null }) {
  const t = useTranslations('portal.me');
  const locale = useLocale();
  const [devices, setDevices] = useState(initial);
  const [pending, setPending] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [done, setDone] = useState<string | null>(null);

  async function signOut(device: Device) {
    setPending(device.id);
    setFailed(false);
    setDone(null);
    try {
      await createBrowserApi().api.call('signOutMyDevice', { params: { id: device.id } });
      setDevices((list) => list.filter((d) => d.id !== device.id));
      setDone(device.label);
    } catch {
      setFailed(true);
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      {limit !== null ? (
        <p className="text-muted m-0 text-sm">
          {t('devicesUsed', { count: devices.length, limit })}
        </p>
      ) : null}
      <ul className="m-0 flex list-none flex-col gap-2.5 p-0">
        {devices.map((device) => (
          <li
            key={device.id}
            className="border-line flex flex-wrap items-center gap-3 rounded-md border p-3.5"
          >
            <Laptop aria-hidden size={20} className="text-muted flex-none" />
            <div className="flex min-w-0 flex-1 flex-col">
              <span className="truncate font-medium">{device.label}</span>
              <span className="text-muted text-[13px]">
                {t('lastUsed', { when: formatLastUsed(device.lastSeenAt, locale) })}
              </span>
            </div>
            {device.current ? (
              <StatusBadge tone="success">{t('thisDevice')}</StatusBadge>
            ) : (
              <Button
                variant="secondary"
                size="sm"
                loading={pending === device.id}
                aria-label={t('signOutLabel', { device: device.label })}
                onClick={() => void signOut(device)}
              >
                {pending === device.id ? t('signingOut') : t('signOut')}
              </Button>
            )}
          </li>
        ))}
      </ul>
      {devices.every((d) => d.current) ? (
        <p className="text-muted m-0 text-sm">{t('noOtherDevices')}</p>
      ) : null}
      {done ? (
        <p role="status" className="text-success-ink m-0 text-sm font-medium">
          {t('signedOut', { device: done })}
        </p>
      ) : null}
      {failed ? <FormAlert>{t('signOutFailed')}</FormAlert> : null}
      {limit !== null ? <p className="text-muted m-0 text-[13px]">{t('devicesIntro', { limit })}</p> : null}
    </div>
  );
}
