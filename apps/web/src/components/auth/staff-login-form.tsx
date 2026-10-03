'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { Button, Checkbox, Field, Input, PasswordInput } from '@remix/ui';
import {
  staffLoginRequestSchema,
  twoStepChallengeSchema,
  type StaffLoginRequest,
  type TwoStepChallenge,
} from '@remix/types/api';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import type { z } from 'zod';
import { FormAlert } from '@/components/form-alert';
import { LoginErrorText } from './login-error-text';
import { TwoStepStep } from './two-step-step';
import { useLoginSubmit } from './use-login-submit';

type Output = z.output<typeof staffLoginRequestSchema>;

/**
 * AUTH-05 staff login (Staff Login 15a/15c): phone or email + password. Validated with the API's
 * schema, posted same-origin, then a full load of `redirectTo`. When the API answers
 * TWO_STEP_REQUIRED (owner/admin/cashier on an untrusted computer) the form becomes the code step
 * (Staff Login 15b/15d).
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
  const { error, setError, navigating, submit } = useLoginSubmit(redirectTo);
  const [twoStep, setTwoStep] = useState<TwoStepChallenge | null>(null);
  const busy = isSubmitting || navigating;

  const onSubmit = handleSubmit((values) =>
    submit(
      (api) => api.call('staffLogin', values),
      (err) => {
        // Only staff login answers FORBIDDEN, for a 2-step role without a mobile number.
        if (err.problem.code === 'FORBIDDEN') {
          setError({ key: 'twoStepNoPhone' });
          return true;
        }
        if (err.problem.code !== 'TWO_STEP_REQUIRED') return false;
        const challenge = twoStepChallengeSchema.safeParse(err.problem.challenge);
        if (!challenge.success) return false;
        setTwoStep(challenge.data);
        return true;
      },
    ),
  );

  if (twoStep) {
    return (
      <TwoStepStep challenge={twoStep} redirectTo={redirectTo} onBack={() => setTwoStep(null)} />
    );
  }

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
