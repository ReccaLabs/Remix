'use client';

import { Button, Field, Input, buttonClass, useToast } from '@remix/ui';
import { CLASS_PLACES, MEDIUMS, type AdminClass, type Hall } from '@remix/types/api';
import { Plus, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState, type ReactNode } from 'react';
import { useFieldArray, useForm, useWatch, type Path } from 'react-hook-form';
import { FormAlert } from '@/components/form-alert';
import { Select } from '@/components/people/select';
import { createBrowserApi } from '@/lib/browser-api';
import {
  blankSlot,
  classPayload,
  DURATIONS,
  emptyClassValues,
  MAX_SLOTS,
  serverClassField,
  validateClass,
  valuesFromClass,
  type ClassFormValues,
} from '@/lib/classes';
import { ADMIN_PATHS } from '@/lib/paths';
import { actionError, fieldErrors, type ActionError } from '@/lib/people';

type Option = { id: string; name: string };

/**
 * Create (CLS-02) and edit class: details, teacher and place, weekly times and the monthly fee
 * in rupees (sent as integer cents). Checked with the API's schemas before sending; the API's
 * field errors (a teacher who left, a hall that was deleted, a duplicate time) land on the field.
 */
export function ClassForm(
  props: { halls: readonly Hall[]; teachers: readonly Option[] } & (
    { mode: 'create' } | { mode: 'edit'; cls: AdminClass }
  ),
) {
  const t = useTranslations('classes.form');
  const tErrors = useTranslations('classes.errors');
  const tMedium = useTranslations('classes.medium');
  const tPlace = useTranslations('classes.place');
  const tDay = useTranslations('classes.weekday');
  const tDuration = useTranslations('classes.form.durations');
  const tMinutes = useTranslations('classes');
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
  } = useForm<ClassFormValues>({
    defaultValues: props.mode === 'edit' ? valuesFromClass(props.cls) : emptyClassValues(),
  });
  const slots = useFieldArray({ control, name: 'schedule' });
  const place = useWatch({ control, name: 'place' });
  const busy = isSubmitting || navigating;
  const err = (path: Path<ClassFormValues>) => {
    const message = (readNested(errors, path) as { message?: string } | undefined)?.message;
    return message ? t(`errors.${message as 'invalid'}`) : undefined;
  };

  // A teacher who is no longer in the list (left, or the list is partial) stays selectable.
  const teachers =
    props.mode === 'edit' && props.cls.teacherId && props.cls.teacherName
      ? props.teachers.some((x) => x.id === props.cls.teacherId)
        ? props.teachers
        : [...props.teachers, { id: props.cls.teacherId, name: props.cls.teacherName }]
      : props.teachers;

  async function onSubmit(values: ClassFormValues) {
    setFailure(null);
    clearErrors();
    const issues = validateClass(props.mode, values);
    if (issues.length > 0) {
      for (const issue of issues) {
        setError(issue.field as Path<ClassFormValues>, {
          type: 'validate',
          message: issue.message,
        });
      }
      return;
    }
    const { api } = createBrowserApi();
    const payload = classPayload(values);
    try {
      const saved =
        props.mode === 'edit'
          ? await api.call('updateClass', payload, { params: { id: props.cls.id } })
          : await api.call('createClass', payload);
      setNavigating(true);
      toast({ tone: 'success', title: t(edit ? 'savedEdit' : 'savedNew') });
      router.push(`${ADMIN_PATHS.classes}/${saved.id}`);
      router.refresh();
    } catch (error) {
      const code = actionError(error);
      const server = fieldErrors(error);
      if (code === 'validation' && Object.keys(server).length > 0) {
        for (const path of Object.keys(server)) {
          const { field, message } = serverClassField(path);
          setError(field as Path<ClassFormValues>, { type: 'server', message });
        }
      } else {
        setFailure(code);
      }
    }
  }

  const cancelHref = edit ? `${ADMIN_PATHS.classes}/${props.cls.id}` : ADMIN_PATHS.classes;
  const durationLabel = (minutes: number) =>
    (DURATIONS as readonly number[]).includes(minutes)
      ? tDuration(String(minutes) as '60')
      : tMinutes('minutes', { count: minutes });

  return (
    <form noValidate onSubmit={handleSubmit(onSubmit)} className="flex max-w-3xl flex-col gap-6">
      <Section title={t('sections.details')}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('fields.name')} error={err('name')} className="sm:col-span-2">
            <Input
              maxLength={120}
              autoComplete="off"
              placeholder={t('fields.namePlaceholder')}
              {...register('name')}
            />
          </Field>
          <Field label={t('fields.grade')} error={err('grade')}>
            <Input
              maxLength={40}
              autoComplete="off"
              placeholder={t('fields.gradePlaceholder')}
              {...register('grade')}
            />
          </Field>
          <Field label={t('fields.medium')} error={err('medium')}>
            <Select {...register('medium')}>
              {MEDIUMS.map((m) => (
                <option key={m} value={m}>
                  {tMedium(m)}
                </option>
              ))}
            </Select>
          </Field>
          <Field
            label={t('fields.startsOn')}
            hint={t('fields.startsOnHint')}
            optional={t('optional')}
            error={err('startsOn')}
            className="sm:col-span-2"
          >
            <Input type="date" {...register('startsOn')} />
          </Field>
        </div>
      </Section>

      <Section title={t('sections.teaching')}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label={t('fields.teacher')}
            hint={t('fields.teacherHint')}
            optional={t('optional')}
            error={err('teacherId')}
          >
            <Select {...register('teacherId')}>
              <option value="">{t('fields.noTeacher')}</option>
              {teachers.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t('fields.place')} error={err('place')}>
            <Select {...register('place')}>
              {CLASS_PLACES.map((p) => (
                <option key={p} value={p}>
                  {tPlace(p)}
                </option>
              ))}
            </Select>
          </Field>
          {place !== 'online' ? (
            <Field
              label={t('fields.hall')}
              optional={t('optional')}
              error={err('hallId')}
              hint={
                props.halls.length === 0 ? (
                  <>
                    {t('fields.hallHint')}{' '}
                    <Link href={ADMIN_PATHS.halls} className="text-brand underline">
                      {t('fields.noHallsLink')}
                    </Link>
                  </>
                ) : undefined
              }
            >
              <Select {...register('hallId')}>
                <option value="">{t('fields.noHall')}</option>
                {props.halls.map((h) => (
                  <option key={h.id} value={h.id}>
                    {h.name}
                  </option>
                ))}
              </Select>
            </Field>
          ) : null}
        </div>
      </Section>

      <Section title={t('sections.schedule')}>
        <p className="text-muted m-0 text-sm">{t('schedule.hint')}</p>
        {slots.fields.length === 0 ? (
          <p className="text-muted m-0 text-sm">{t('schedule.empty')}</p>
        ) : null}
        <ul className="m-0 flex list-none flex-col gap-3 p-0">
          {slots.fields.map((field, index) => (
            <li key={field.id}>
              <fieldset className="border-line bg-canvas m-0 grid gap-3 rounded-lg border p-3 sm:grid-cols-[1fr_1fr_1fr_auto] sm:items-start">
                <legend className="sr-only">{t('schedule.row', { number: index + 1 })}</legend>
                <Field label={t('schedule.weekday')}>
                  <Select {...register(`schedule.${index}.weekday`)}>
                    {[1, 2, 3, 4, 5, 6, 7].map((d) => (
                      <option key={d} value={d}>
                        {tDay(String(d) as '1')}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label={t('schedule.start')} error={err(`schedule.${index}.startTime`)}>
                  <Input type="time" {...register(`schedule.${index}.startTime`)} />
                </Field>
                <Field
                  label={t('schedule.duration')}
                  error={err(`schedule.${index}.durationMinutes`)}
                >
                  <Select {...register(`schedule.${index}.durationMinutes`)}>
                    {durationOptions(field.durationMinutes).map((m) => (
                      <option key={m} value={m}>
                        {durationLabel(m)}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Button
                  variant="ghost"
                  className="sm:mt-7"
                  aria-label={t('schedule.remove', { number: index + 1 })}
                  onClick={() => slots.remove(index)}
                >
                  <Trash2 aria-hidden size={18} />
                </Button>
              </fieldset>
            </li>
          ))}
        </ul>
        <div className="flex flex-wrap items-center gap-3">
          <Button
            variant="secondary"
            disabled={slots.fields.length >= MAX_SLOTS}
            onClick={() => slots.append(blankSlot())}
          >
            <Plus aria-hidden size={16} />
            {t('schedule.add')}
          </Button>
          {slots.fields.length >= MAX_SLOTS ? (
            <span className="text-muted text-sm">{t('schedule.limit')}</span>
          ) : null}
        </div>
      </Section>

      <Section title={t('sections.fee')}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('fields.fee')} hint={t('fields.feeHint')} error={err('fee')}>
            <Input inputMode="decimal" autoComplete="off" {...register('fee')} />
          </Field>
        </div>
      </Section>

      {failure ? <FormAlert>{tErrors(failure)}</FormAlert> : null}

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Link href={cancelHref} className={buttonClass({ variant: 'secondary' })}>
          {t('cancel')}
        </Link>
        <Button type="submit" loading={busy}>
          {busy ? t('saving') : t(edit ? 'submitEdit' : 'submitNew')}
        </Button>
      </div>
    </form>
  );
}

/** The usual lengths, plus the class's own when it is something else (e.g. 135 minutes). */
function durationOptions(current: string): number[] {
  const value = Number(current);
  const all = new Set<number>([...DURATIONS, ...(Number.isFinite(value) ? [value] : [])]);
  return [...all].sort((a, b) => a - b);
}

function Section({ title, children }: { title: ReactNode; children: ReactNode }) {
  return (
    <section className="bg-surface border-line flex flex-col gap-4 rounded-lg border p-4 lg:p-6">
      <h2 className="m-0 text-lg font-semibold leading-6">{title}</h2>
      {children}
    </section>
  );
}

/** `errors.schedule.1.startTime` from a dotted path. */
function readNested(source: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((value, key) => {
    if (value === null || typeof value !== 'object') return undefined;
    return (value as Record<string, unknown>)[key];
  }, source);
}
