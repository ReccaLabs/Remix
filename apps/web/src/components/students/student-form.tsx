'use client';

import { Button, Checkbox, Field, Input, PhoneInput, buttonClass, useToast } from '@remix/ui';
import {
  CONSENT_METHODS,
  GUARDIAN_RELATIONS,
  MEDIUMS,
  type AdminClass,
  type StudentProfile,
} from '@remix/types/api';
import { Plus, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useFormatter, useTranslations } from 'next-intl';
import { useState } from 'react';
import { useFieldArray, useForm, useWatch, type Path } from 'react-hook-form';
import { FormAlert } from '@/components/form-alert';
import { Select } from '@/components/people/select';
import { createBrowserApi } from '@/lib/browser-api';
import { ADMIN_PATHS } from '@/lib/paths';
import {
  actionError,
  currentMonth,
  fieldErrors,
  monthDate,
  monthOptions,
  type ActionError,
} from '@/lib/people';
import {
  blankGuardian,
  createPayload,
  emptyValues,
  MAX_GUARDIANS,
  updatePayload,
  validateStudent,
  valuesFromProfile,
  type StudentFormValues,
} from '@/lib/student-form';

type ClassOption = Pick<AdminClass, 'id' | 'name'>;

/**
 * Add student (STU-03) and edit student (STU-05): contact details, up to three guardians
 * (PAR-01) and, for students under 18, who gave consent and how (PAR-03). Validated with the
 * API's schemas before sending; server errors (duplicate phone, …) are shown on the form.
 */
export function StudentForm(
  props:
    { mode: 'create'; classes: readonly ClassOption[] } | { mode: 'edit'; student: StudentProfile },
) {
  const t = useTranslations('students.form');
  const tErrors = useTranslations('students.errors');
  const format = useFormatter();
  const router = useRouter();
  const { toast } = useToast();
  const edit = props.mode === 'edit';
  const [failure, setFailure] = useState<ActionError | null>(null);
  const [navigating, setNavigating] = useState(false);

  const {
    register,
    handleSubmit,
    control,
    setError,
    clearErrors,
    formState: { errors, isSubmitting },
  } = useForm<StudentFormValues>({
    defaultValues:
      props.mode === 'edit' ? valuesFromProfile(props.student) : emptyValues(currentMonth()),
  });
  const guardians = useFieldArray({ control, name: 'guardians' });
  const under18 = useWatch({ control, name: 'under18' });
  const busy = isSubmitting || navigating;
  const err = (path: Path<StudentFormValues>) => {
    const message = (readNested(errors, path) as { message?: string } | undefined)?.message;
    return message ? t(`errors.${message as 'invalid'}`) : undefined;
  };

  async function onSubmit(values: StudentFormValues) {
    setFailure(null);
    clearErrors();
    const payload =
      props.mode === 'edit' ? updatePayload(values, props.student) : createPayload(values);
    const issues = validateStudent(props.mode, payload);
    if (issues.length > 0) {
      for (const issue of issues) {
        setError(issue.field as Path<StudentFormValues>, {
          type: 'validate',
          message: issue.message,
        });
      }
      return;
    }
    const { api } = createBrowserApi();
    try {
      const saved =
        props.mode === 'edit'
          ? await api.call('updateStudent', updatePayload(values, props.student), {
              params: { id: props.student.id },
            })
          : await api.call('createStudent', createPayload(values));
      setNavigating(true);
      toast({ tone: 'success', title: t(props.mode === 'edit' ? 'savedEdit' : 'savedNew') });
      router.push(`${ADMIN_PATHS.students}/${saved.id}`);
      router.refresh();
    } catch (error) {
      const code = actionError(error);
      const server = fieldErrors(error);
      if (code === 'conflict') {
        setError('phone', { type: 'server', message: 'phoneTaken' });
      } else if (code === 'validation' && Object.keys(server).length > 0) {
        for (const path of Object.keys(server)) {
          const field = path === 'consent' ? 'consentGivenBy' : path;
          setError(field as Path<StudentFormValues>, { type: 'server', message: 'invalid' });
        }
      } else {
        setFailure(code);
      }
    }
  }

  const cancelHref = edit ? `${ADMIN_PATHS.students}/${props.student.id}` : ADMIN_PATHS.students;

  return (
    <form noValidate onSubmit={handleSubmit(onSubmit)} className="flex max-w-3xl flex-col gap-6">
      <Section title={t('sections.details')}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('fields.name')} error={err('displayName')}>
            <Input autoComplete="off" maxLength={120} {...register('displayName')} />
          </Field>
          <Field
            label={t('fields.phone')}
            hint={edit ? undefined : t('fields.phoneHint')}
            error={err('phone')}
          >
            <PhoneInput {...register('phone')} autoComplete="off" />
          </Field>
          <Field label={t('fields.school')} optional={t('optional')}>
            <Input maxLength={120} {...register('school')} />
          </Field>
          <Field label={t('fields.alYear')} optional={t('optional')} error={err('alYear')}>
            <Select {...register('alYear')}>
              <option value="">{t('fields.notSet')}</option>
              {yearOptions().map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t('fields.medium')} optional={t('optional')}>
            <Select {...register('medium')}>
              <option value="">{t('fields.notSet')}</option>
              {MEDIUMS.map((m) => (
                <option key={m} value={m}>
                  {t(`mediums.${m}`)}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      </Section>

      {props.mode === 'create' ? (
        <Section title={t('sections.classes')} hint={t('classesHint')}>
          {props.classes.length === 0 ? (
            <p className="text-muted m-0 text-sm">{t('noClasses')}</p>
          ) : (
            <div className="flex flex-col gap-3">
              <fieldset className="m-0 flex flex-col border-0 p-0">
                <legend className="sr-only">{t('sections.classes')}</legend>
                {props.classes.map((c) => (
                  <Checkbox key={c.id} label={c.name} value={c.id} {...register('classIds')} />
                ))}
              </fieldset>
              <Field label={t('fields.enrolFrom')} className="max-w-xs">
                <Select {...register('enrolFrom')}>
                  {monthOptions(currentMonth(), 6).map((m) => (
                    <option key={m} value={m}>
                      {format.dateTime(monthDate(m), { month: 'long', year: 'numeric' })}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
          )}
        </Section>
      ) : null}

      <Section title={t('sections.guardians')} hint={t('guardiansHint', { max: MAX_GUARDIANS })}>
        <div className="flex flex-col gap-4">
          {guardians.fields.map((field, index) => (
            <fieldset
              key={field.id}
              className="border-line bg-canvas m-0 flex flex-col gap-3 rounded-md border p-3"
            >
              <legend className="px-1 text-sm font-semibold">
                {t('guardianN', { n: index + 1 })}
              </legend>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label={t('fields.guardianName')} error={err(`guardians.${index}.name`)}>
                  <Input maxLength={120} {...register(`guardians.${index}.name`)} />
                </Field>
                <Field label={t('fields.relation')}>
                  <Select {...register(`guardians.${index}.relation`)}>
                    {GUARDIAN_RELATIONS.map((r) => (
                      <option key={r} value={r}>
                        {t(`relations.${r}`)}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label={t('fields.guardianPhone')} error={err(`guardians.${index}.phone`)}>
                  <PhoneInput autoComplete="off" {...register(`guardians.${index}.phone`)} />
                </Field>
                <div className="flex items-end">
                  <Checkbox
                    label={t('fields.smsOptIn')}
                    {...register(`guardians.${index}.smsOptIn`)}
                  />
                </div>
              </div>
              <div>
                <Button variant="ghost" size="sm" onClick={() => guardians.remove(index)}>
                  <Trash2 aria-hidden size={16} />
                  {t('removeGuardian')}
                </Button>
              </div>
            </fieldset>
          ))}
          {guardians.fields.length < MAX_GUARDIANS ? (
            <div>
              <Button variant="secondary" onClick={() => guardians.append(blankGuardian())}>
                <Plus aria-hidden size={18} />
                {t('addGuardian')}
              </Button>
            </div>
          ) : null}
        </div>
      </Section>

      <Section title={t('sections.consent')}>
        <div className="flex flex-col gap-3">
          <Checkbox label={t('fields.under18')} hint={t('under18Hint')} {...register('under18')} />
          {under18 ? (
            <div className="border-line bg-canvas grid gap-3 rounded-md border p-3 sm:grid-cols-2">
              <Field label={t('fields.consentGivenBy')} error={err('consentGivenBy')}>
                <Input maxLength={120} {...register('consentGivenBy')} />
              </Field>
              <Field label={t('fields.consentMethod')}>
                <Select {...register('consentMethod')}>
                  {CONSENT_METHODS.map((m) => (
                    <option key={m} value={m}>
                      {t(`consentMethods.${m}`)}
                    </option>
                  ))}
                </Select>
              </Field>
              <p className="text-muted m-0 text-[13px] sm:col-span-2">{t('consentHint')}</p>
            </div>
          ) : null}
        </div>
      </Section>

      {props.mode === 'create' ? (
        <Checkbox
          label={t('fields.sendWelcomeSms')}
          hint={t('welcomeSmsHint')}
          {...register('sendWelcomeSms')}
        />
      ) : null}

      {failure ? <FormAlert>{tErrors(failure)}</FormAlert> : null}

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Link href={cancelHref} className={buttonClass({ variant: 'secondary', size: 'lg' })}>
          {t('cancel')}
        </Link>
        <Button type="submit" size="lg" loading={busy}>
          {busy ? t('saving') : t(edit ? 'saveEdit' : 'saveNew')}
        </Button>
      </div>
    </form>
  );
}

function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="bg-surface border-line flex flex-col gap-4 rounded-lg border p-4 lg:p-5">
      <div className="flex flex-col gap-1">
        <h2 className="m-0 text-base font-semibold">{title}</h2>
        {hint ? <p className="text-muted m-0 text-sm">{hint}</p> : null}
      </div>
      {children}
    </section>
  );
}

/** A/L exam years offered: this year and the next five. */
function yearOptions(): number[] {
  const year = Number(currentMonth().slice(0, 4));
  return Array.from({ length: 6 }, (_, i) => year + i);
}

function readNested(errors: unknown, path: string): unknown {
  return path
    .split('.')
    .reduce<unknown>((acc, key) => (acc as Record<string, unknown> | undefined)?.[key], errors);
}
