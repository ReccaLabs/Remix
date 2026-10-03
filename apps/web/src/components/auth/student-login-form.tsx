'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { Button, Checkbox, Field, PasswordInput, PhoneInput } from '@remix/ui';
import {
  deviceLimitChallengeSchema,
  studentLoginRequestSchema,
  type DeviceLimitChallenge,
  type StudentLoginRequest,
} from '@remix/types/api';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import type { z } from 'zod';
import { FormAlert } from '@/components/form-alert';
import { DeviceLimitStep } from './device-limit-step';
import { LoginErrorText } from './login-error-text';
import { useLoginSubmit } from './use-login-submit';

type Output = z.output<typeof studentLoginRequestSchema>;

/**
 * AUTH-01 student login (Student Login 1a/1d): phone + password + "stay signed in". Validated
 * with the API's own schema before sending, posted same-origin, then a full load of
 * `redirectTo` so the portal renders with the new session cookie. A third device gets the
 * device chooser (AUTH-03, Student Login 1c) instead of an error.
 */
export function StudentLoginForm({ redirectTo }: { redirectTo: string }) {
  const t = useTranslations('auth');
  const {
    register,
    handleSubmit,
    getValues,
    formState: { errors, isSubmitting },
  } = useForm<StudentLoginRequest, unknown, Output>({
    resolver: zodResolver(studentLoginRequestSchema),
    defaultValues: { phone: '', password: '', staySignedIn: false },
  });
  const { error, navigating, submit } = useLoginSubmit(redirectTo);
  const [deviceLimit, setDeviceLimit] = useState<DeviceLimitChallenge | null>(null);
  const busy = isSubmitting || navigating;

  const onSubmit = handleSubmit((values) =>
    submit(
      (api) => api.call('studentLogin', values),
      (err) => {
        if (err.problem.code !== 'DEVICE_LIMIT') return false;
        const challenge = deviceLimitChallengeSchema.safeParse(err.problem.challenge);
        if (!challenge.success) return false;
        setDeviceLimit(challenge.data);
        return true;
      },
    ),
  );

  if (deviceLimit) {
    return (
      <DeviceLimitStep
        challenge={deviceLimit}
        redirectTo={redirectTo}
        onCancel={() => setDeviceLimit(null)}
      />
    );
  }

  const phoneError = errors.phone
    ? getValues('phone').trim() === ''
      ? t('validation.phoneRequired')
      : t('validation.phoneInvalid')
    : undefined;
  const passwordError = errors.password
    ? errors.password.type === 'too_big'
      ? t('validation.passwordTooLong')
      : t('validation.passwordRequired')
    : undefined;

  return (
    <form noValidate onSubmit={onSubmit} className="flex flex-col gap-6">
      <div className="flex flex-col gap-4">
        <Field label={t('fields.phone')} hint={t('fields.phoneHint')} error={phoneError}>
          <PhoneInput controlSize="lg" {...register('phone')} />
        </Field>
        <Field label={t('fields.password')} error={passwordError}>
          <PasswordInput
            controlSize="lg"
            showLabel={t('fields.showPassword')}
            hideLabel={t('fields.hidePassword')}
            {...register('password')}
          />
        </Field>
        <Checkbox
          label={t('fields.staySignedIn')}
          hint={t('fields.staySignedInHint')}
          {...register('staySignedIn')}
        />
      </div>
      {error ? (
        <FormAlert>
          <LoginErrorText error={error} who="student" />
        </FormAlert>
      ) : null}
      <Button type="submit" size="xl" block loading={busy}>
        {busy ? t('student.submitting') : t('student.submit')}
      </Button>
    </form>
  );
}
