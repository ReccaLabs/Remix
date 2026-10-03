'use client';

import { Button, Field, Input, buttonClass, cn } from '@remix/ui';
import { STUDENT_STATUSES, type AdminClass } from '@remix/types/api';
import { ListFilter, Search } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useRef, useState, type FormEvent } from 'react';
import { Select } from '@/components/people/select';
import { ADMIN_PATHS } from '@/lib/paths';
import { hasFilters, parseListQuery, studentsHref, type ListQuery } from '@/lib/people';

/**
 * Search and filters of the students table (STU-01). The URL is the state: submitting (Enter,
 * the Search button, or changing any filter) navigates to the same page with new query
 * parameters, so filtered lists can be bookmarked and shared, and Back works.
 */
export function StudentsToolbar({
  query,
  classes,
}: {
  query: ListQuery;
  classes: readonly Pick<AdminClass, 'id' | 'name'>[];
}) {
  const t = useTranslations('students.list.filters');
  const tStatus = useTranslations('students.status');
  const tSort = useTranslations('students.list.sort');
  const router = useRouter();
  const form = useRef<HTMLFormElement>(null);
  // Phones: filters hide behind a button (open when one is active); from md up they always show.
  const [open, setOpen] = useState(hasFilters(query));

  function apply(event?: FormEvent) {
    event?.preventDefault();
    if (!form.current) return;
    const values = Object.fromEntries(
      [...new FormData(form.current).entries()].filter(
        (entry): entry is [string, string] => typeof entry[1] === 'string',
      ),
    );
    // Page size is not a field: keep it. Invalid values are dropped by the parser.
    const next = parseListQuery({ ...values, pageSize: String(query.pageSize) });
    router.push(studentsHref(ADMIN_PATHS.students, next));
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
          aria-controls="student-filters"
          onClick={() => setOpen((v) => !v)}
        >
          <ListFilter aria-hidden size={18} />
          {t('toggle')}
        </Button>
      </div>
      <div id="student-filters" className={cn(open ? 'contents' : 'hidden', 'md:contents')}>
        {classes.length > 0 ? (
          <Field label={t('class')}>
            <Select name="classId" defaultValue={query.classId ?? ''} onChange={change}>
              <option value="">{t('allClasses')}</option>
              {classes.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
        ) : null}
        <Field label={t('status')}>
          <Select name="status" defaultValue={query.status ?? ''} onChange={change}>
            <option value="">{t('anyStatus')}</option>
            {STUDENT_STATUSES.map((s) => (
              <option key={s} value={s}>
                {tStatus(s)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('devices')}>
          <Select
            name="minDevices"
            defaultValue={query.minDevices?.toString() ?? ''}
            onChange={change}
          >
            <option value="">{t('anyDevices')}</option>
            <option value="1">{t('devicesAny')}</option>
            <option value="2">{t('devicesLimit')}</option>
          </Select>
        </Field>
        <Field label={t('joinedFrom')}>
          <Input
            type="date"
            name="joinedFrom"
            defaultValue={query.joinedFrom ?? ''}
            onChange={change}
          />
        </Field>
        <Field label={t('joinedTo')}>
          <Input
            type="date"
            name="joinedTo"
            defaultValue={query.joinedTo ?? ''}
            onChange={change}
          />
        </Field>
        <Field label={t('sort')}>
          <Select name="sort" defaultValue={query.sort} onChange={change}>
            <option value="name">{tSort('name')}</option>
            <option value="studentNo">{tSort('studentNo')}</option>
            <option value="joined">{tSort('joined')}</option>
          </Select>
        </Field>
        {hasFilters(query) ? (
          <div className="flex items-end">
            <Link
              href={ADMIN_PATHS.students}
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
