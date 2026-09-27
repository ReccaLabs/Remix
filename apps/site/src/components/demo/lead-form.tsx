'use client';

import { LEAD_LIMITS, leadSchema, type LeadIntent } from '@remix/types/lead';
import { buttonClass, cn } from '@remix/ui';
import { AlertTriangle, CheckCircle2, Info, Loader2 } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import {
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
  type FormEvent,
  type ReactNode,
} from 'react';

import {
  AffixInput,
  Checkbox,
  ErrorSummary,
  Field,
  FieldError,
  FieldHint,
  Input,
  Label,
  Textarea,
} from '@/components/forms';
import { Link } from '@/i18n/navigation';
import { ROUTES, SITE } from '@/lib/site';
import { Turnstile } from './turnstile';

/** Subscribes to nothing; with useSyncExternalStore it reports false on the server, true after hydration. */
const noopSubscribe = () => () => {};

/** Fields that can show an error, in on-screen order (first invalid one gets focus). */
const FIELDS = [
  'name',
  'phone',
  'institute',
  'students',
  'city',
  'message',
  'turnstileToken',
] as const;
type ErrorField = (typeof FIELDS)[number];
type ErrorKind = 'required' | 'invalid';
type Errors = Partial<Record<ErrorField, ErrorKind>>;

type Values = {
  name: string;
  phone: string;
  whatsappSame: boolean;
  institute: string;
  students: string;
  city: string;
  message: string;
};

type Status = 'idle' | 'submitting' | 'success' | 'failed' | 'verification';

const EMPTY: Values = {
  name: '',
  phone: '',
  whatsappSame: true,
  institute: '',
  students: '',
  city: '',
  message: '',
};
const REQUEST_TIMEOUT_MS = 15_000;

function isErrorField(value: unknown): value is ErrorField {
  return typeof value === 'string' && (FIELDS as readonly string[]).includes(value);
}

/** Client-side check with the same schema the Pages Function uses. */
function validate(values: Values, intent: LeadIntent) {
  const result = leadSchema.safeParse({ ...values, message: values.message || undefined, intent });
  const errors: Errors = {};
  if (!result.success) {
    for (const issue of result.error.issues) {
      const field = issue.path[0];
      if (!isErrorField(field) || errors[field]) continue;
      const raw = field === 'turnstileToken' ? '' : values[field];
      errors[field] = raw.trim() === '' ? 'required' : 'invalid';
    }
  }
  return { result, errors };
}

export function LeadForm({
  initialIntent,
  whatsappHref,
}: {
  initialIntent: LeadIntent;
  whatsappHref: string | null;
}) {
  const t = useTranslations('demo.form');
  const ts = useTranslations('demo.success');
  const locale = useLocale();
  const uid = useId();
  const id = (field: string) => `lead-${field}-${uid}`;

  const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? '';

  const [values, setValues] = useState<Values>(EMPTY);
  const [intent, setIntent] = useState<LeadIntent>(initialIntent);
  const [errors, setErrors] = useState<Errors>({});
  const [attempted, setAttempted] = useState(false);
  const [status, setStatus] = useState<Status>('idle');
  const [token, setToken] = useState<string | null>(null);
  const [turnstileReset, setTurnstileReset] = useState(0);
  const [turnstileDown, setTurnstileDown] = useState(false);
  const [focusTick, setFocusTick] = useState(0);
  const [sentPhone, setSentPhone] = useState<{ phone: string; whatsapp: boolean } | null>(null);

  const hydrated = useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  );

  const fieldRefs = useRef<Partial<Record<ErrorField, HTMLElement | null>>>({});
  const statusRef = useRef<HTMLDivElement>(null);
  const successRef = useRef<HTMLHeadingElement>(null);

  // After a failed attempt, move focus to the first invalid field (its error is in aria-describedby).
  useEffect(() => {
    if (focusTick === 0) return;
    const first = FIELDS.find((f) => errors[f] && fieldRefs.current[f]);
    if (first) fieldRefs.current[first]?.focus();
    else statusRef.current?.focus();
    // Only when a new attempt asks for it — not on every keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusTick]);

  useEffect(() => {
    if (status === 'success') successRef.current?.focus();
    if (status === 'failed' || status === 'verification') statusRef.current?.focus();
  }, [status]);

  function update<K extends keyof Values>(key: K, value: Values[K]) {
    const next = { ...values, [key]: value };
    setValues(next);
    if (attempted)
      setErrors((prev) => ({
        ...validate(next, intent).errors,
        turnstileToken: prev.turnstileToken,
      }));
  }

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (status === 'submitting') return;
    setAttempted(true);

    const { result, errors: found } = validate(values, intent);
    if (siteKey && !token && !turnstileDown) found.turnstileToken = 'required';
    setErrors(found);
    if (!result.success || found.turnstileToken) {
      setStatus('idle');
      setFocusTick((n) => n + 1);
      return;
    }

    setStatus('submitting');
    const payload = { ...result.data, turnstileToken: token ?? '' };

    try {
      const res = await fetch('/api/lead', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });

      if (res.ok) {
        setSentPhone({ phone: result.data.phone, whatsapp: result.data.whatsappSame });
        setStatus('success');
        return;
      }

      // Every failure consumed the token; get a fresh one for the retry.
      setTurnstileReset((n) => n + 1);

      if (res.status === 403) {
        setStatus('verification');
        return;
      }
      if (res.status === 400) {
        const body = (await res.json().catch(() => null)) as {
          issues?: { field?: unknown }[];
        } | null;
        const serverErrors: Errors = {};
        for (const issue of body?.issues ?? []) {
          if (isErrorField(issue.field) && issue.field !== 'turnstileToken')
            serverErrors[issue.field] = 'invalid';
        }
        if (Object.keys(serverErrors).length > 0) {
          setErrors(serverErrors);
          setStatus('idle');
          setFocusTick((n) => n + 1);
          return;
        }
      }
      setStatus('failed');
    } catch {
      setTurnstileReset((n) => n + 1);
      setStatus('failed');
    }
  }

  if (status === 'success' && sentPhone) {
    return (
      <div className="flex flex-col items-start gap-4 py-6" aria-live="polite">
        <span className="bg-success-soft text-success-ink flex size-11 items-center justify-center rounded-full">
          <CheckCircle2 size={24} aria-hidden />
        </span>
        <h2 ref={successRef} tabIndex={-1} className="m-0 text-[22px] font-semibold leading-7">
          {ts('title')}
        </h2>
        <p className="text-ink-2 m-0">
          {ts('body', {
            phone: sentPhone.phone.replace(/^\+94(\d{2})(\d{3})(\d{4})$/, '+94 $1 $2 $3'),
            channel: sentPhone.whatsapp ? 'whatsapp' : 'phone',
          })}
        </p>
        <p className="text-muted m-0 text-sm">{ts('note', { email: SITE.email.sales })}</p>
        <Link href={ROUTES.home} className={buttonClass({ variant: 'outline', className: 'mt-2' })}>
          {ts('back')}
        </Link>
      </div>
    );
  }

  const describedBy = (...ids: (string | false | undefined)[]) =>
    ids.filter(Boolean).join(' ') || undefined;
  const errorFor = (field: ErrorField): ReactNode =>
    errors[field] ? (
      <FieldError id={id(`${field}-error`)}>{t(`errors.${field}.${errors[field]}`)}</FieldError>
    ) : null;
  const register = (field: ErrorField) => (el: HTMLElement | null) => {
    fieldRefs.current[field] = el;
  };

  const summary = FIELDS.filter((f) => errors[f]).map((f) => ({
    id: f === 'turnstileToken' ? id('turnstile') : id(f),
    message: t(`errors.${f}.${errors[f] ?? 'invalid'}`),
  }));
  const submitting = status === 'submitting';
  const wa = whatsappHref;

  return (
    <form
      // POST, never the default GET: personal data must not end up in a URL (history, logs).
      method="post"
      noValidate
      onSubmit={onSubmit}
      aria-labelledby={id('title')}
      className="flex flex-col gap-5"
    >
      <h2 id={id('title')} className="m-0 text-xl font-semibold leading-7">
        {t('title')}
      </h2>

      <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
        <legend className="text-ink mb-2 p-0 text-sm font-medium">{t('intentLegend')}</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {(['demo', 'trial'] as const).map((value) => (
            <label key={value} className="relative block">
              <input
                type="radio"
                name={id('intent')}
                value={value}
                checked={intent === value}
                onChange={() => setIntent(value)}
                className="peer sr-only"
              />
              <span
                className={cn(
                  'flex min-h-16 cursor-pointer flex-col justify-center rounded-md border px-4 py-2.5 transition-colors',
                  'peer-focus-visible:outline-brand peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2',
                  intent === value
                    ? 'border-brand bg-brand-soft'
                    : 'border-line-strong bg-surface hover:border-ink-2',
                )}
              >
                <span className="text-ink font-semibold">{t(`intent.${value}`)}</span>
                <span className="text-muted text-[13px] leading-5">{t(`intent.${value}Hint`)}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <Field>
        <Label htmlFor={id('name')}>{t('name.label')}</Label>
        <Input
          ref={register('name')}
          id={id('name')}
          name="name"
          autoComplete="name"
          maxLength={LEAD_LIMITS.name}
          placeholder={t('name.placeholder')}
          value={values.name}
          onChange={(e) => update('name', e.target.value)}
          invalid={!!errors.name}
          aria-describedby={describedBy(errors.name && id('name-error'))}
        />
        {errorFor('name')}
      </Field>

      <Field>
        <Label htmlFor={id('phone')}>{t('phone.label')}</Label>
        <AffixInput
          ref={register('phone')}
          id={id('phone')}
          name="phone"
          type="tel"
          inputMode="tel"
          autoComplete="tel-national"
          maxLength={20}
          prefix={t('phone.prefix')}
          placeholder={t('phone.placeholder')}
          value={values.phone}
          onChange={(e) => update('phone', e.target.value)}
          invalid={!!errors.phone}
          aria-describedby={describedBy(id('phone-hint'), errors.phone && id('phone-error'))}
        />
        <FieldHint id={id('phone-hint')}>{t('phone.hint')}</FieldHint>
        {errorFor('phone')}
        <Checkbox
          name="whatsappSame"
          checked={values.whatsappSame}
          onChange={(e) => update('whatsappSame', e.target.checked)}
          label={t('whatsappSame')}
        />
      </Field>

      <Field>
        <Label htmlFor={id('institute')}>{t('institute.label')}</Label>
        <Input
          ref={register('institute')}
          id={id('institute')}
          name="institute"
          autoComplete="organization"
          maxLength={LEAD_LIMITS.institute}
          placeholder={t('institute.placeholder')}
          value={values.institute}
          onChange={(e) => update('institute', e.target.value)}
          invalid={!!errors.institute}
          aria-describedby={describedBy(errors.institute && id('institute-error'))}
        />
        {errorFor('institute')}
      </Field>

      <div className="grid gap-5 sm:grid-cols-2">
        <Field>
          <Label htmlFor={id('students')}>{t('students.label')}</Label>
          <Input
            ref={register('students')}
            id={id('students')}
            name="students"
            inputMode="numeric"
            autoComplete="off"
            maxLength={6}
            placeholder={t('students.placeholder')}
            value={values.students}
            onChange={(e) => update('students', e.target.value)}
            invalid={!!errors.students}
            aria-describedby={describedBy(
              id('students-hint'),
              errors.students && id('students-error'),
            )}
            className="tabular"
          />
          <FieldHint id={id('students-hint')}>{t('students.hint')}</FieldHint>
          {errorFor('students')}
        </Field>

        <Field>
          <Label htmlFor={id('city')}>{t('city.label')}</Label>
          <Input
            ref={register('city')}
            id={id('city')}
            name="city"
            autoComplete="address-level2"
            maxLength={LEAD_LIMITS.city}
            placeholder={t('city.placeholder')}
            value={values.city}
            onChange={(e) => update('city', e.target.value)}
            invalid={!!errors.city}
            aria-describedby={describedBy(errors.city && id('city-error'))}
          />
          {errorFor('city')}
        </Field>
      </div>

      <Field>
        <Label htmlFor={id('message')} optional={t('optional')}>
          {t('message.label')}
        </Label>
        <Textarea
          ref={register('message')}
          id={id('message')}
          name="message"
          rows={4}
          maxLength={LEAD_LIMITS.message}
          placeholder={t('message.placeholder')}
          value={values.message}
          onChange={(e) => update('message', e.target.value)}
          invalid={!!errors.message}
          aria-describedby={describedBy(errors.message && id('message-error'))}
        />
        {errorFor('message')}
      </Field>

      <div id={id('turnstile')} className="flex flex-col gap-2">
        {siteKey ? (
          <Turnstile
            siteKey={siteKey}
            language={locale}
            resetKey={turnstileReset}
            onToken={(value) => {
              setToken(value);
              if (value) setErrors((prev) => ({ ...prev, turnstileToken: undefined }));
            }}
            onUnavailable={() => setTurnstileDown(true)}
          />
        ) : (
          <Notice tone="info">{t('turnstile.devNotice')}</Notice>
        )}
        {turnstileDown ? <Notice tone="warning">{t('turnstile.unavailable')}</Notice> : null}
        {errorFor('turnstileToken')}
      </div>

      <div ref={statusRef} tabIndex={-1} className="flex flex-col gap-3 outline-none empty:hidden">
        {attempted && summary.length > 0 ? (
          <ErrorSummary title={t('summaryTitle', { count: summary.length })} items={summary} />
        ) : null}
        {status === 'failed' ? (
          <Notice tone="danger" title={t('failure.title')}>
            {wa
              ? t.rich('failure.whatsapp', {
                  link: (chunks) => (
                    <a
                      href={wa}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-danger-ink font-semibold underline"
                    >
                      {chunks}
                    </a>
                  ),
                })
              : t.rich('failure.email', {
                  email: SITE.email.sales,
                  link: (chunks) => (
                    <a
                      href={`mailto:${SITE.email.sales}`}
                      className="text-danger-ink font-semibold underline"
                    >
                      {chunks}
                    </a>
                  ),
                })}
          </Notice>
        ) : null}
        {status === 'verification' ? (
          <Notice tone="danger" title={t('verification.title')}>
            {t('verification.body')}
          </Notice>
        ) : null}
      </div>

      <button
        type="submit"
        // Disabled until hydrated: a disabled default button also blocks Enter-key submission,
        // so the browser can never submit the form natively before onSubmit is attached.
        disabled={!hydrated}
        aria-disabled={submitting || undefined}
        className={buttonClass({
          size: 'lg',
          className: cn('w-full', submitting && 'cursor-wait opacity-80'),
        })}
      >
        {submitting ? (
          <>
            <Loader2 size={18} aria-hidden className="motion-safe:animate-spin" />
            {t('submitting')}
          </>
        ) : (
          t(`submit.${intent}`)
        )}
      </button>
      <p className="sr-only" aria-live="polite">
        {submitting ? t('submitting') : ''}
      </p>

      <p className="text-muted m-0 text-[13px] leading-5">
        {t.rich('privacy', {
          link: (chunks) => (
            <Link href={ROUTES.privacy} className="font-medium">
              {chunks}
            </Link>
          ),
        })}
      </p>
    </form>
  );
}

function Notice({
  tone,
  title,
  children,
}: {
  tone: 'info' | 'warning' | 'danger';
  title?: string;
  children: ReactNode;
}) {
  const styles = {
    info: 'border-info bg-info-soft text-ink',
    warning: 'border-accent-line bg-accent-tint text-ink',
    danger: 'border-danger bg-danger-soft text-ink',
  } as const;
  const Icon = tone === 'info' ? Info : AlertTriangle;
  return (
    <div
      role={tone === 'danger' ? 'alert' : undefined}
      className={cn('flex gap-2.5 rounded-md border px-4 py-3 text-sm', styles[tone])}
    >
      <Icon
        size={18}
        aria-hidden
        className={cn(
          'mt-px flex-none',
          tone === 'danger'
            ? 'text-danger-ink'
            : tone === 'warning'
              ? 'text-accent-ink'
              : 'text-info',
        )}
      />
      <div className="flex flex-col gap-0.5">
        {title ? <p className="m-0 font-semibold">{title}</p> : null}
        <p className="m-0">{children}</p>
      </div>
    </div>
  );
}
