'use client';

import { Button, Field, PasswordInput, Skeleton } from '@remix/ui';
import { ApiError, newPasswordSchema, type InvitePreview } from '@remix/types/api';
import { LinkIcon } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { FormAlert } from '@/components/form-alert';
import { TIME_ZONE } from '@/i18n/config';
import { createBrowserApi } from '@/lib/browser-api';
import { codeStepErrorFor } from '@/lib/login-errors';
import { readInviteToken } from '@/lib/invite-token';
import { LoginErrorText } from './login-error-text';
import { useLoginSubmit } from './use-login-submit';

/** Preview the invitation for a token read from the fragment; any failure is "invalid". */
async function loadPreview(token: string | null): Promise<State> {
  if (!token) return { status: 'invalid' };
  try {
    const preview = await createBrowserApi().api.call('previewInvite', { token });
    return { status: 'ready', token, preview };
  } catch {
    return { status: 'invalid' };
  }
}

type State =
  | { status: 'loading' }
  | { status: 'invalid' }
  | { status: 'ready'; token: string; preview: InvitePreview };

/**
 * AUTH-07 staff invitation (`/admin/invite#<token>`). The token is read from the URL fragment —
 * which browsers never send to a server — and removed from the address bar and history at once;
 * after that it lives only in memory and is sent in POST bodies (preview, accept), never in a
 * URL. Accepting creates the account, signs in and opens the admin.
 */
export function InviteAcceptance({ redirectTo }: { redirectTo: string }) {
  const t = useTranslations('auth');
  const locale = useLocale();
  const [state, setState] = useState<State>({ status: 'loading' });
  const [password, setPassword] = useState('');
  const [fieldError, setFieldError] = useState<string | undefined>();
  const [conflict, setConflict] = useState(false);
  const [pending, setPending] = useState(false);
  const { error, setError, navigating, submit } = useLoginSubmit(redirectTo);
  const started = useRef(false);

  useEffect(() => {
    // Once per mount (React may run effects twice in development).
    if (started.current) return;
    started.current = true;
    void loadPreview(readInviteToken(window.location, window.history)).then(setState);
  }, []);

  if (state.status === 'loading') {
    return (
      <div className="flex flex-col gap-3" role="status" aria-live="polite">
        <span className="sr-only">{t('invite.loading')}</span>
        <Skeleton className="h-5 w-3/4" />
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-12 w-full" />
      </div>
    );
  }

  if (state.status === 'invalid') {
    return (
      <div className="flex flex-col gap-2" role="alert">
        <div className="flex items-center gap-2">
          <LinkIcon aria-hidden size={18} className="text-danger-ink flex-none" />
          <h2 className="m-0 text-lg font-semibold">{t('invite.invalidTitle')}</h2>
        </div>
        <p className="text-muted m-0">{t('invite.invalidBody')}</p>
      </div>
    );
  }

  const { token, preview } = state;
  const busy = pending || navigating;
  const expires = new Intl.DateTimeFormat(locale, {
    timeZone: TIME_ZONE,
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(preview.expiresAt));

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    const parsed = newPasswordSchema.safeParse(password);
    if (!parsed.success) {
      setFieldError(
        password.length > 128 ? t('validation.newPasswordTooLong') : t('validation.newPasswordTooShort'),
      );
      return;
    }
    setFieldError(undefined);
    setConflict(false);
    setPending(true);
    await submit(
      (api) => api.call('acceptInvite', { token, newPassword: parsed.data }),
      (err: ApiError) => {
        if (err.problem.code === 'INVITE_INVALID') {
          setState({ status: 'invalid' });
          return true;
        }
        if (err.problem.code === 'CONFLICT') {
          setConflict(true);
          return true;
        }
        if (err.problem.code === 'VALIDATION_FAILED') {
          setError(codeStepErrorFor(err, 'password'));
          return true;
        }
        return false;
      },
    );
    setPending(false);
  }

  return (
    <form noValidate onSubmit={onSubmit} className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <h2 className="m-0 text-lg font-semibold">
          {t('invite.title', { institute: preview.tenantName })}
        </h2>
        <p className="text-muted m-0">
          {t('invite.intro', { name: preview.displayName, role: t(`roles.${preview.role}`) })}
        </p>
        <p className="text-muted m-0 text-[13px]">{t('invite.expires', { when: expires })}</p>
      </div>
      <Field label={t('fields.newPassword')} hint={t('fields.newPasswordHint')} error={fieldError}>
        <PasswordInput
          autoComplete="new-password"
          showLabel={t('fields.showPassword')}
          hideLabel={t('fields.hidePassword')}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </Field>
      {conflict ? (
        <FormAlert>{t('invite.conflict')}</FormAlert>
      ) : error ? (
        <FormAlert>
          <LoginErrorText error={error} who="staff" />
        </FormAlert>
      ) : null}
      <Button type="submit" size="lg" block loading={busy}>
        {busy ? t('invite.accepting') : t('invite.accept')}
      </Button>
    </form>
  );
}
