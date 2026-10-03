'use client';

import { Button, Field, PasswordInput } from '@remix/ui';
import { ApiError, newPasswordSchema } from '@remix/types/api';
import { useTranslations } from 'next-intl';
import { useState, type FormEvent } from 'react';
import { LoginErrorText } from '@/components/auth/login-error-text';
import { FormAlert } from '@/components/form-alert';
import { createBrowserApi } from '@/lib/browser-api';
import { codeStepErrorFor, parseRetryAfter, type LoginError } from '@/lib/login-errors';

/**
 * AUTH-04 change password while signed in. The API revokes every session of the user and gives
 * this browser a fresh session cookie, so the student stays signed in here only.
 */
export function ChangePasswordForm() {
  const tAuth = useTranslations('auth');
  const t = useTranslations('portal.me');
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [errors, setErrors] = useState<{ current?: string; next?: string }>({});
  const [error, setError] = useState<LoginError | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setSaved(false);
    setError(null);
    const fieldErrors: { current?: string; next?: string } = {};
    if (!current) fieldErrors.current = tAuth('validation.passwordRequired');
    if (!newPasswordSchema.safeParse(next).success) {
      fieldErrors.next =
        next.length > 128
          ? tAuth('validation.newPasswordTooLong')
          : tAuth('validation.newPasswordTooShort');
    }
    setErrors(fieldErrors);
    if (fieldErrors.current || fieldErrors.next) return;

    setBusy(true);
    const { api, retryAfter } = createBrowserApi();
    try {
      await api.call('changePassword', { currentPassword: current, newPassword: next });
      setCurrent('');
      setNext('');
      setSaved(true);
    } catch (err) {
      if (err instanceof ApiError && err.problem.code === 'INVALID_CREDENTIALS') {
        setErrors({ current: t('currentWrong') });
      } else {
        setError(codeStepErrorFor(err, 'password', parseRetryAfter(retryAfter())));
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <form noValidate onSubmit={onSubmit} className="flex flex-col gap-4">
      <p className="text-muted m-0 text-sm">{t('passwordIntro')}</p>
      <Field label={tAuth('fields.currentPassword')} error={errors.current}>
        <PasswordInput
          autoComplete="current-password"
          showLabel={tAuth('fields.showPassword')}
          hideLabel={tAuth('fields.hidePassword')}
          value={current}
          onChange={(e) => setCurrent(e.target.value)}
        />
      </Field>
      <Field
        label={tAuth('fields.newPassword')}
        hint={tAuth('fields.newPasswordHint')}
        error={errors.next}
      >
        <PasswordInput
          autoComplete="new-password"
          showLabel={tAuth('fields.showPassword')}
          hideLabel={tAuth('fields.hidePassword')}
          value={next}
          onChange={(e) => setNext(e.target.value)}
        />
      </Field>
      {error ? (
        <FormAlert>
          <LoginErrorText error={error} who="student" />
        </FormAlert>
      ) : null}
      {saved ? (
        <p role="status" className="text-success-ink m-0 text-sm font-medium">
          {t('passwordChanged')}
        </p>
      ) : null}
      <Button type="submit" size="lg" loading={busy} className="self-start">
        {busy ? t('savingPassword') : t('savePassword')}
      </Button>
    </form>
  );
}
