'use client';

import { Button, Checkbox, Field } from '@remix/ui';
import { ApiError, otpCodeSchema, type TwoStepChallenge } from '@remix/types/api';
import { Smartphone } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState, type FormEvent } from 'react';
import { FormAlert } from '@/components/form-alert';
import { createBrowserApi } from '@/lib/browser-api';
import { loginErrorFor, parseRetryAfter, type LoginError } from '@/lib/login-errors';
import { CodeInput } from './code-input';
import { LoginErrorText } from './login-error-text';
import { formatCountdown, useCountdown } from './use-countdown';
import { useLoginSubmit } from './use-login-submit';

/**
 * AUTH-05 (Staff Login 15b/15d): owner, admin and cashier enter the SMS code on an untrusted
 * computer; "trust this computer" skips it there for 30 days. The challenge token stays in
 * memory and travels only in POST bodies.
 */
export function TwoStepStep({
  challenge: initial,
  redirectTo,
  onBack,
}: {
  challenge: TwoStepChallenge;
  redirectTo: string;
  onBack: () => void;
}) {
  const t = useTranslations('auth');
  const [challenge, setChallenge] = useState(initial);
  const [code, setCode] = useState('');
  const [trust, setTrust] = useState(false);
  const [codeError, setCodeError] = useState<string | undefined>();
  const [resendError, setResendError] = useState<LoginError | null>(null);
  const [resent, setResent] = useState(false);
  const [pending, setPending] = useState(false);
  const { secondsLeft, restart } = useCountdown(initial.resendAfterSeconds);
  const { error, navigating, submit } = useLoginSubmit(redirectTo);
  const busy = pending || navigating;

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    const parsed = otpCodeSchema.safeParse(code);
    if (!parsed.success) {
      setCodeError(t('validation.codeInvalid'));
      return;
    }
    setCodeError(undefined);
    setResent(false);
    setPending(true);
    await submit((api) =>
      api.call('verifyTwoStep', { token: challenge.token, code: parsed.data, trustDevice: trust }),
    );
    setPending(false);
  }

  async function resend() {
    setResendError(null);
    setResent(false);
    const { api, retryAfter } = createBrowserApi();
    try {
      const next = await api.call('resendTwoStep', { token: challenge.token });
      setChallenge(next);
      restart(next.resendAfterSeconds);
      setCode('');
      setResent(true);
    } catch (err) {
      setResendError(
        loginErrorFor(err, err instanceof ApiError ? parseRetryAfter(retryAfter()) : null),
      );
    }
  }

  const shown = resendError ?? error;

  return (
    <form noValidate onSubmit={onSubmit} className="flex flex-col gap-5">
      <div className="flex items-start gap-3">
        <span className="bg-brand-soft text-brand flex size-10 flex-none items-center justify-center rounded-md">
          <Smartphone aria-hidden size={20} />
        </span>
        <div className="flex flex-col gap-1">
          <h2 className="m-0 text-xl font-semibold tracking-[-0.01em]">{t('twoStep.title')}</h2>
          <p className="text-muted m-0">{t('twoStep.body', { phone: challenge.maskedPhone })}</p>
        </div>
      </div>
      <Field label={t('fields.code')} error={codeError}>
        <CodeInput value={code} onChange={(e) => setCode(e.target.value)} />
      </Field>
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        {secondsLeft > 0 ? (
          <span className="text-muted">
            {t('twoStep.resendIn', { time: formatCountdown(secondsLeft) })}
          </span>
        ) : (
          <Button type="button" variant="ghost" size="sm" onClick={() => void resend()}>
            {t('twoStep.resend')}
          </Button>
        )}
        {resent ? (
          <span role="status" className="text-success-ink font-medium">
            {t('twoStep.resent')}
          </span>
        ) : null}
      </div>
      <Checkbox
        label={t('fields.trustComputer')}
        hint={t('fields.trustComputerHint')}
        checked={trust}
        onChange={(e) => setTrust(e.target.checked)}
      />
      {shown ? (
        <FormAlert>
          <LoginErrorText error={shown} who="staff" />
        </FormAlert>
      ) : null}
      <Button type="submit" size="lg" block loading={busy}>
        {busy ? t('twoStep.verifying') : t('twoStep.verify')}
      </Button>
      <Button type="button" variant="ghost" size="md" block onClick={onBack}>
        {t('twoStep.back')}
      </Button>
    </form>
  );
}
