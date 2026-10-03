'use client';

import { Button, FieldError, cn } from '@remix/ui';
import { ApiError, type DeviceLimitChallenge } from '@remix/types/api';
import { Laptop, ShieldCheck } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useState, type FormEvent } from 'react';
import { FormAlert } from '@/components/form-alert';
import { formatLastUsed } from '@/lib/device-time';
import { LoginErrorText } from './login-error-text';
import { useLoginSubmit } from './use-login-submit';

/**
 * AUTH-03 (Student Login 1c): the password was right but the student is signed in on 2 devices.
 * Choose one to sign out; the single-use challenge token finishes the login on this device.
 */
export function DeviceLimitStep({
  challenge,
  redirectTo,
  onCancel,
}: {
  challenge: DeviceLimitChallenge;
  redirectTo: string;
  onCancel: () => void;
}) {
  const t = useTranslations('auth');
  const locale = useLocale();
  const [chosen, setChosen] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);
  const [stale, setStale] = useState<'changed' | 'expired' | null>(null);
  const { error, navigating, submit } = useLoginSubmit(redirectTo);
  const [pending, setPending] = useState(false);
  const busy = pending || navigating;

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!chosen) {
      setMissing(true);
      return;
    }
    setPending(true);
    await submit(
      (api) =>
        api.call('resolveDeviceLimit', { token: challenge.token, signOutDeviceId: chosen }),
      (err: ApiError) => {
        if (err.problem.code === 'CONFLICT') setStale('changed');
        else if (err.problem.code === 'CODE_INVALID') setStale('expired');
        else return false;
        return true;
      },
    );
    setPending(false);
  }

  return (
    <form noValidate onSubmit={onSubmit} className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <h2 className="m-0 text-xl font-semibold tracking-[-0.01em]">{t('deviceLimit.title')}</h2>
        <p className="text-muted m-0">{t('deviceLimit.body')}</p>
      </div>
      <fieldset className="m-0 flex flex-col gap-2.5 border-0 p-0">
        <legend className="mb-2 p-0 text-sm font-medium">{t('deviceLimit.legend')}</legend>
        {challenge.devices.map((device) => (
          <label
            key={device.id}
            className={cn(
              'border-line bg-surface flex min-h-11 cursor-pointer items-center gap-3 rounded-md border p-3.5',
              'has-[:checked]:border-brand has-[:checked]:bg-brand-soft has-[:focus-visible]:outline-brand has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2',
            )}
          >
            <input
              type="radio"
              name="device"
              value={device.id}
              checked={chosen === device.id}
              onChange={() => {
                setChosen(device.id);
                setMissing(false);
              }}
              className="accent-brand size-5 flex-none"
            />
            <Laptop aria-hidden size={20} className="text-muted flex-none" />
            <span className="flex flex-col">
              <span className="font-medium">{device.label}</span>
              <span className="text-muted text-[13px]">
                {t('deviceLimit.lastUsed', { when: formatLastUsed(device.lastSeenAt, locale) })}
              </span>
            </span>
          </label>
        ))}
        {missing ? <FieldError>{t('deviceLimit.chooseDevice')}</FieldError> : null}
      </fieldset>
      <p className="bg-canvas text-ink-2 m-0 flex gap-2.5 rounded-md p-3 text-[13px]">
        <ShieldCheck aria-hidden size={16} className="mt-0.5 flex-none" />
        <span>{t('deviceLimit.why')}</span>
      </p>
      {stale ? (
        <FormAlert>
          {stale === 'changed' ? t('deviceLimit.changed') : t('errors.ticketExpired')}
        </FormAlert>
      ) : error ? (
        <FormAlert>
          <LoginErrorText error={error} who="student" />
        </FormAlert>
      ) : null}
      {stale ? null : (
        <Button type="submit" size="xl" block loading={busy}>
          {busy ? t('deviceLimit.continuing') : t('deviceLimit.continue')}
        </Button>
      )}
      <Button type="button" variant="secondary" size="lg" block onClick={onCancel}>
        {t('deviceLimit.cancel')}
      </Button>
    </form>
  );
}
