'use client';

import { Button, Field, PasswordInput, PhoneInput, buttonClass } from '@remix/ui';
import {
  newPasswordSchema,
  OTP_RULES,
  otpCodeSchema,
  type OtpPurpose,
} from '@remix/types/api';
import { sriLankaMobile } from '@remix/types/phone';
import { CircleCheck } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useState, type FormEvent } from 'react';
import { FormAlert } from '@/components/form-alert';
import { createBrowserApi } from '@/lib/browser-api';
import { codeStepErrorFor, parseRetryAfter, type LoginError } from '@/lib/login-errors';
import { CodeInput } from './code-input';
import { LoginErrorText } from './login-error-text';
import { formatCountdown, useCountdown } from './use-countdown';

type Step = 'phone' | 'code' | 'password' | 'done';

/**
 * AUTH-02 forgot password, AUTH-07 first password, AUTH-09 unlock (Student Login 1b): phone →
 * 6-digit code (resend after 45 s) → new password → done. The phone step never says whether the
 * number has an account (the API answers the same either way). The password ticket from the
 * code step lives only in this component's memory and is sent once, in a POST body.
 */
export function CodeFlow({
  purpose,
  who,
  loginHref,
}: {
  purpose: OtpPurpose;
  who: 'student' | 'staff';
  loginHref: string;
}) {
  const t = useTranslations('auth');
  const [step, setStep] = useState<Step>('phone');
  const [phone, setPhone] = useState('');
  const [normalised, setNormalised] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [ticket, setTicket] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<string | undefined>();
  const [error, setError] = useState<LoginError | null>(null);
  const [busy, setBusy] = useState(false);
  const { secondsLeft, restart } = useCountdown();

  async function run(
    stepName: 'request' | 'verify' | 'password',
    work: (api: ReturnType<typeof createBrowserApi>['api']) => Promise<void>,
  ) {
    setError(null);
    setBusy(true);
    const { api, retryAfter } = createBrowserApi();
    try {
      await work(api);
    } catch (err) {
      setError(codeStepErrorFor(err, stepName, parseRetryAfter(retryAfter())));
    } finally {
      setBusy(false);
    }
  }

  async function requestCode(target: string) {
    await run('request', async (api) => {
      const res = await api.call('requestOtp', { phone: target, purpose });
      restart(res.resendAfterSeconds);
      setStep('code');
    });
  }

  function onPhone(event: FormEvent) {
    event.preventDefault();
    const parsed = sriLankaMobile.safeParse(phone);
    if (!parsed.success) {
      setFieldError(phone.trim() ? t('validation.phoneInvalid') : t('validation.phoneRequired'));
      return;
    }
    setFieldError(undefined);
    setNormalised(parsed.data);
    void requestCode(parsed.data);
  }

  function onCode(event: FormEvent) {
    event.preventDefault();
    const parsed = otpCodeSchema.safeParse(code);
    if (!parsed.success) {
      setFieldError(t('validation.codeInvalid'));
      return;
    }
    setFieldError(undefined);
    void run('verify', async (api) => {
      const res = await api.call('verifyOtp', { phone: normalised, purpose, code: parsed.data });
      setTicket(res.ticket);
      setStep(purpose === 'unlock' || res.ticket === null ? 'done' : 'password');
    });
  }

  function onPassword(event: FormEvent) {
    event.preventDefault();
    const parsed = newPasswordSchema.safeParse(password);
    if (!parsed.success || !ticket) {
      setFieldError(
        password.length > 128 ? t('validation.newPasswordTooLong') : t('validation.newPasswordTooShort'),
      );
      return;
    }
    setFieldError(undefined);
    void run('password', async (api) => {
      await api.call('setPassword', { ticket, newPassword: parsed.data });
      setTicket(null);
      setStep('done');
    });
  }

  function startAgain() {
    setStep('phone');
    setCode('');
    setPassword('');
    setTicket(null);
    setError(null);
    setFieldError(undefined);
  }

  const alert = error ? (
    <FormAlert>
      <LoginErrorText error={error} who={who} />
    </FormAlert>
  ) : null;

  if (step === 'done') {
    const unlocked = purpose === 'unlock';
    return (
      <div className="flex flex-col gap-5" role="status">
        <div className="flex items-start gap-3">
          <CircleCheck aria-hidden size={24} className="text-success-ink mt-0.5 flex-none" />
          <div className="flex flex-col gap-1">
            <h2 className="m-0 text-lg font-semibold">
              {unlocked ? t('code.unlockedTitle') : t('code.doneTitle')}
            </h2>
            <p className="text-muted m-0">
              {unlocked ? t('code.unlockedBody') : t('code.doneBody')}
            </p>
          </div>
        </div>
        <Link href={loginHref} className={buttonClass({ size: 'lg', className: 'w-full' })}>
          {t('code.toLogin')}
        </Link>
      </div>
    );
  }

  if (step === 'password') {
    return (
      <form noValidate onSubmit={onPassword} className="flex flex-col gap-5">
        <h2 className="m-0 text-lg font-semibold">{t('code.passwordTitle')}</h2>
        <Field label={t('fields.newPassword')} hint={t('fields.newPasswordHint')} error={fieldError}>
          <PasswordInput
            controlSize="lg"
            autoComplete="new-password"
            showLabel={t('fields.showPassword')}
            hideLabel={t('fields.hidePassword')}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </Field>
        {alert}
        {error?.key === 'ticketExpired' ? (
          <Button type="button" variant="secondary" size="lg" block onClick={startAgain}>
            {t('code.startAgain')}
          </Button>
        ) : (
          <Button type="submit" size="lg" block loading={busy}>
            {busy ? t('code.saving') : t('code.savePassword')}
          </Button>
        )}
      </form>
    );
  }

  if (step === 'code') {
    return (
      <form noValidate onSubmit={onCode} className="flex flex-col gap-5">
        <div className="flex flex-col gap-1">
          <h2 className="m-0 text-lg font-semibold">{t('code.enterTitle')}</h2>
          <p className="text-muted m-0">{t('code.sentTo', { phone: normalised })}</p>
        </div>
        <Field label={t('fields.code')} error={fieldError}>
          <CodeInput controlSize="lg" value={code} onChange={(e) => setCode(e.target.value)} />
        </Field>
        {alert}
        <Button type="submit" size="lg" block loading={busy}>
          {busy ? t('code.verifying') : t('code.verify')}
        </Button>
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
          <span className="text-muted">{t('code.notReceived')}</span>
          {secondsLeft > 0 ? (
            <span className="text-muted" aria-live="off">
              {t('code.resendIn', { time: formatCountdown(secondsLeft) })}
            </span>
          ) : (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={busy}
              onClick={() => void requestCode(normalised)}
            >
              {t('code.resend')}
            </Button>
          )}
        </div>
        <Button type="button" variant="ghost" size="sm" onClick={startAgain}>
          {t('code.changePhone')}
        </Button>
      </form>
    );
  }

  return (
    <form noValidate onSubmit={onPhone} className="flex flex-col gap-5">
      <Field label={t('fields.phone')} hint={t('fields.phoneHint')} error={fieldError}>
        <PhoneInput controlSize="lg" value={phone} onChange={(e) => setPhone(e.target.value)} />
      </Field>
      {alert}
      <Button type="submit" size="lg" block loading={busy}>
        {busy ? t('code.sending') : t('code.sendCode')}
      </Button>
    </form>
  );
}

/** Exported for tests: the resend wait the API promises. */
export const RESEND_SECONDS = OTP_RULES.resendAfterSeconds;
