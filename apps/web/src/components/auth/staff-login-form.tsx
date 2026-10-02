'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { Button, Checkbox, Field, Input, PasswordInput } from '@remix/ui';
import { staffLoginRequestSchema, type StaffLoginRequest } from '@remix/types/api';
import { useTranslations } from 'next-intl';
import { useForm } from 'react-hook-form';
import type { z } from 'zod';
import { FormAlert } from '@/components/form-alert';
import { LoginErrorText } from './login-error-text';
import { useLoginSubmit } from './use-login-submit';

type Output = z.output<typeof staffLoginRequestSchema>;

/**
 * AUTH-05 basic staff login (Staff Login 15a/15c): phone or email + password. Validated with the
 * API's schema, posted same-origin, then a full load of `redirectTo`.
 *
 * 2-step SMS (Phase 2, Staff Login 15b/15d): when the login response asks for a code, this form
 * becomes step 1 of two. Add a `step` state here ('credentials' | 'code') and render the code
 * step (6-digit input, resend timer, "trust this computer") instead of navigating — the API
 * contract for that challenge lands with AUTH-05 phase 2.
 */
export function StaffLoginForm({ redirectTo }: { redirectTo: string }) {
  const t = useTranslations('auth');
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<StaffLoginRequest, unknown, Output>({
    resolver: zodResolver(staffLoginRequestSchema),
    defaultValues: { identifier: '', password: '', staySignedIn: false },
  });
  const { error, navigating, submit } = useLoginSubmit(redirectTo);
  const busy = isSubmitting || navigating;

  const onSubmit = handleSubmit((values) => submit((api) => api.call('staffLogin', values)));

  const passwordError = errors.password
    ? errors.password.type === 'too_big'
      ? t('validation.passwordTooLong')
      : t('validation.passwordRequired')
    : undefined;

  return (
    <form noValidate onSubmit={onSubmit} className="flex flex-col gap-5">
      <Field
        label={t('fields.identifier')}
        error={errors.identifier ? t('validation.identifierRequired') : undefined}
      >
        <Input
          type="text"
          autoComplete="username"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          {...register('identifier')}
        />
      </Field>
      <Field label={t('fields.password')} error={passwordError}>
        <PasswordInput
          showLabel={t('fields.showPassword')}
          hideLabel={t('fields.hidePassword')}
          {...register('password')}
        />
      </Field>
      <Checkbox label={t('fields.keepSignedIn')} {...register('staySignedIn')} />
      {error ? (
        <FormAlert>
          <LoginErrorText error={error} who="staff" />
        </FormAlert>
      ) : null}
      <Button type="submit" size="lg" block loading={busy}>
        {busy ? t('staff.submitting') : t('staff.submit')}
      </Button>
    </form>
  );
}
