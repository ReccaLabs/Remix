'use client';

import { buttonClass } from '@remix/ui';
import { ArrowRight } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useId, useRef, useState, type FormEvent } from 'react';
import { AffixInput, Field, FieldError, FieldHint, Label } from '@/components/forms';
import { parseClassAddress, type FindClassResult } from '@/lib/find-class';

type Reason = Extract<FindClassResult, { ok: false }>['reason'];

/**
 * Takes a class address and navigates to https://<slug>.remix.lk/. All validation is in
 * parseClassAddress (lib/find-class.ts) — it can only ever produce *.remix.lk URLs.
 */
export function FindClassForm() {
  const t = useTranslations('demo.findClass');
  const uid = useId();
  const inputId = `find-class-${uid}`;
  const [value, setValue] = useState('');
  const [error, setError] = useState<Reason | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const preview = parseClassAddress(value);

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const result = parseClassAddress(value);
    if (!result.ok) {
      setError(result.reason);
      inputRef.current?.focus();
      return;
    }
    setError(null);
    window.location.assign(result.url);
  }

  return (
    <form noValidate onSubmit={onSubmit} className="flex flex-col gap-4">
      <Field>
        <Label htmlFor={inputId}>{t('label')}</Label>
        <AffixInput
          ref={inputRef}
          id={inputId}
          name="class"
          type="text"
          inputMode="url"
          autoComplete="off"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          maxLength={253}
          placeholder={t('placeholder')}
          suffix={t('suffix')}
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            if (error) setError(null);
          }}
          invalid={!!error}
          aria-describedby={`${inputId}-hint${error ? ` ${inputId}-error` : ''}`}
        />
        <FieldHint id={`${inputId}-hint`}>{t('hint')}</FieldHint>
        {error ? <FieldError id={`${inputId}-error`}>{t(`errors.${error}`)}</FieldError> : null}
      </Field>

      <p className="text-muted m-0 min-h-6 break-all text-sm" aria-live="polite">
        {preview.ok ? t('preview', { url: preview.url }) : ''}
      </p>

      <button
        type="submit"
        className={buttonClass({ size: 'lg', className: 'w-full sm:w-auto sm:self-start' })}
      >
        {t('submit')}
        <ArrowRight size={16} aria-hidden />
      </button>
    </form>
  );
}
