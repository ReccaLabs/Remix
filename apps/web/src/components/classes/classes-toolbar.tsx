'use client';

import { Button, Field, Input, buttonClass, cn } from '@remix/ui';
import { CLASS_PLACES } from '@remix/types/api';
import { ListFilter, Search } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useRef, useState, type FormEvent } from 'react';
import { Select } from '@/components/people/select';
import { classesHref, hasClassFilters, parseClassesQuery, type ClassesQuery } from '@/lib/classes';
import { ADMIN_PATHS } from '@/lib/paths';

/**
 * Search and filters of the classes list (CLS-01). The URL is the state, as on the students
 * list: any change navigates to the same page with new query parameters, so a filtered list can
 * be bookmarked and Back works. Phones hide the filters behind a button.
 */
export function ClassesToolbar({
  query,
  grades,
  teachers,
}: {
  query: ClassesQuery;
  grades: readonly string[];
  teachers: readonly { id: string; name: string }[];
}) {
  const t = useTranslations('classes.list.filters');
  const tPlace = useTranslations('classes.place');
  const router = useRouter();
  const form = useRef<HTMLFormElement>(null);
  const [open, setOpen] = useState(hasClassFilters(query));

  function apply(event?: FormEvent) {
    event?.preventDefault();
    if (!form.current) return;
    const values = Object.fromEntries(
      [...new FormData(form.current).entries()].filter(
        (entry): entry is [string, string] => typeof entry[1] === 'string',
      ),
    );
    router.push(classesHref(ADMIN_PATHS.classes, parseClassesQuery(values)));
  }
  const change = () => form.current?.requestSubmit();

  return (
    <form
      ref={form}
      role="search"
      aria-label={t('label')}
      onSubmit={apply}
      className="bg-surface border-line grid grid-cols-[repeat(auto-fit,minmax(11rem,1fr))] gap-3 rounded-lg border p-3 lg:p-4"
    >
      <div className="col-span-full flex flex-wrap items-end gap-2">
        <Field label={t('search')} className="min-w-48 flex-1">
          <Input
            type="search"
            name="q"
            defaultValue={query.q ?? ''}
            autoComplete="off"
            maxLength={80}
          />
        </Field>
        <Button type="submit" variant="secondary" aria-label={t('searchButton')}>
          <Search aria-hidden size={18} />
        </Button>
        <Button
          variant="secondary"
          className="md:hidden"
          aria-expanded={open}
          aria-controls="class-filters"
          onClick={() => setOpen((v) => !v)}
        >
          <ListFilter aria-hidden size={18} />
          {t('toggle')}
        </Button>
      </div>
      <div id="class-filters" className={cn(open ? 'contents' : 'hidden', 'md:contents')}>
        {grades.length > 0 ? (
          <Field label={t('grade')}>
            <Select name="grade" defaultValue={query.grade ?? ''} onChange={change}>
              <option value="">{t('allGrades')}</option>
              {grades.map((g) => (
                <option key={g} value={g}>
                  {g}
                </option>
              ))}
            </Select>
          </Field>
        ) : null}
        <Field label={t('place')}>
          <Select name="place" defaultValue={query.place ?? ''} onChange={change}>
            <option value="">{t('anyPlace')}</option>
            {CLASS_PLACES.map((p) => (
              <option key={p} value={p}>
                {tPlace(p)}
              </option>
            ))}
          </Select>
        </Field>
        {teachers.length > 0 ? (
          <Field label={t('teacher')}>
            <Select name="teacherId" defaultValue={query.teacherId ?? ''} onChange={change}>
              <option value="">{t('anyTeacher')}</option>
              {teachers.map((teacher) => (
                <option key={teacher.id} value={teacher.id}>
                  {teacher.name}
                </option>
              ))}
            </Select>
          </Field>
        ) : null}
        <Field label={t('show')}>
          <Select name="archived" defaultValue={query.archived} onChange={change}>
            <option value="false">{t('showActive')}</option>
            <option value="true">{t('showArchived')}</option>
          </Select>
        </Field>
        {hasClassFilters(query) ? (
          <div className="flex items-end">
            <Link
              href={ADMIN_PATHS.classes}
              className={buttonClass({
                variant: 'ghost',
                size: 'md',
                className: 'w-full sm:w-auto',
              })}
            >
              {t('clear')}
            </Link>
          </div>
        ) : null}
      </div>
    </form>
  );
}
