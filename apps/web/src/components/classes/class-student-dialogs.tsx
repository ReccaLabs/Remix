'use client';

import { Button, Checkbox, Field, Input, useToast } from '@remix/ui';
import type { ClassStudent, StudentListItem } from '@remix/types/api';
import { Search } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useFormatter, useTranslations } from 'next-intl';
import { useState, type FormEvent } from 'react';
import { FormAlert } from '@/components/form-alert';
import { Dialog } from '@/components/people/dialog';
import { Select } from '@/components/people/select';
import { createBrowserApi } from '@/lib/browser-api';
import { feeProblem, formatFee, parseRupees, rupeesText } from '@/lib/classes';
import {
  actionError,
  currentMonth,
  formatPhone,
  monthDate,
  monthOptions,
  type ActionError,
} from '@/lib/people';

type ClassOption = { id: string; name: string };

/** Shown month names ("October 2026") for `monthOptions`. */
function MonthSelect({
  value,
  onChange,
  months,
  id,
}: {
  value: string;
  onChange: (value: string) => void;
  months: readonly string[];
  id?: string;
}) {
  const format = useFormatter();
  return (
    <Select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
      {months.map((m) => (
        <option key={m} value={m}>
          {format.dateTime(monthDate(m), { month: 'long', year: 'numeric' })}
        </option>
      ))}
    </Select>
  );
}

/** The footer of every dialog form: Cancel and the one action. */
function Footer({
  busy,
  cancel,
  confirm,
  disabled,
  onCancel,
}: {
  busy: boolean;
  cancel: string;
  confirm: string;
  disabled?: boolean;
  onCancel: () => void;
}) {
  return (
    <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
      <Button variant="secondary" disabled={busy} onClick={onCancel}>
        {cancel}
      </Button>
      <Button type="submit" loading={busy} disabled={disabled}>
        {confirm}
      </Button>
    </div>
  );
}

// ---- add students (CLS-04) -------------------------------------------------------------------

export function EnrolDialog({
  open,
  classId,
  className,
  enrolledIds,
  onClose,
}: {
  open: boolean;
  classId: string;
  className: string;
  /** Students already in the class: shown but not selectable. */
  enrolledIds: ReadonlySet<string>;
  onClose: () => void;
}) {
  const t = useTranslations('classes.students.enrol');
  const tErrors = useTranslations('classes.students.errors');
  const tAll = useTranslations('classes.errors');
  const router = useRouter();
  const { toast } = useToast();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<StudentListItem[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchFailed, setSearchFailed] = useState(false);
  const [chosen, setChosen] = useState<ReadonlyMap<string, string>>(new Map());
  const [month, setMonth] = useState(currentMonth());
  const [custom, setCustom] = useState(false);
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<ActionError | null>(null);
  const [formError, setFormError] = useState<'amountInvalid' | 'reasonRequired' | null>(null);

  async function search(event?: FormEvent) {
    event?.preventDefault();
    if (query.trim() === '') return;
    setSearching(true);
    setSearchFailed(false);
    try {
      const { api } = createBrowserApi();
      const page = await api.call('listStudents', { query: { q: query.trim(), pageSize: 25 } });
      setResults(page.items);
    } catch {
      setSearchFailed(true);
    } finally {
      setSearching(false);
    }
  }

  function toggle(student: StudentListItem) {
    setChosen((prev) => {
      const next = new Map(prev);
      if (!next.delete(student.id)) next.set(student.id, student.displayName);
      return next;
    });
  }

  function close() {
    setResults(null);
    setQuery('');
    setChosen(new Map());
    setCustom(false);
    setAmount('');
    setReason('');
    setFailure(null);
    setFormError(null);
    onClose();
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setFailure(null);
    setFormError(null);
    let override: { feeOverrideCents: number; reason: string } | undefined;
    if (custom) {
      const cents = parseRupees(amount);
      if (cents === null || feeProblem(amount)) return setFormError('amountInvalid');
      if (reason.trim() === '') return setFormError('reasonRequired');
      override = { feeOverrideCents: cents, reason: reason.trim() };
    }
    setBusy(true);
    try {
      const { api } = createBrowserApi();
      const result = await api.call(
        'enrolStudents',
        { studentIds: [...chosen.keys()], fromMonth: month, ...override },
        { params: { id: classId } },
      );
      toast({
        tone: result.enrolled > 0 ? 'success' : 'warning',
        title: t('done', { count: result.enrolled }),
        description:
          result.skipped.length > 0
            ? t('doneSkipped', { count: result.skipped.length })
            : undefined,
      });
      close();
      router.refresh();
    } catch (err) {
      setFailure(actionError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={close}
      busy={busy}
      title={t('title', { name: className })}
      description={t('body')}
    >
      <div className="flex flex-col gap-4">
        <form role="search" onSubmit={(e) => void search(e)} className="flex items-end gap-2">
          <Field label={t('search')} className="min-w-0 flex-1">
            <Input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              autoComplete="off"
              maxLength={80}
            />
          </Field>
          <Button
            type="submit"
            variant="secondary"
            loading={searching}
            aria-label={t('searchButton')}
          >
            <Search aria-hidden size={18} />
          </Button>
        </form>

        <div aria-live="polite" className="flex flex-col gap-2">
          {searchFailed ? <FormAlert>{t('loadFailed')}</FormAlert> : null}
          {results === null && !searchFailed ? (
            <p className="text-muted m-0 text-sm">{t('searchFirst')}</p>
          ) : null}
          {results?.length === 0 ? (
            <p className="text-muted m-0 text-sm">{t('noResults')}</p>
          ) : null}
          {results && results.length > 0 ? (
            <ul
              aria-label={t('results')}
              className="border-line m-0 max-h-56 list-none overflow-y-auto rounded-md border p-0"
            >
              {results.map((s) => {
                const already = enrolledIds.has(s.id);
                return (
                  <li key={s.id} className="border-line-soft border-b last:border-b-0">
                    <label
                      className={`flex min-h-11 items-center gap-3 px-3 py-2 ${already ? 'opacity-70' : 'cursor-pointer'}`}
                    >
                      <input
                        type="checkbox"
                        className="accent-brand size-5 flex-none"
                        checked={already || chosen.has(s.id)}
                        disabled={already}
                        onChange={() => toggle(s)}
                        aria-label={t('pick', { name: s.displayName })}
                      />
                      <span className="flex min-w-0 flex-col">
                        <span className="truncate font-medium">{s.displayName}</span>
                        <span className="text-muted truncate text-sm">
                          {s.studentNo} · {formatPhone(s.phone)}
                          {already ? ` · ${t('alreadyIn')}` : ''}
                        </span>
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          ) : null}
          <p role="status" className="m-0 text-sm font-medium">
            {t('selected', { count: chosen.size })}
          </p>
        </div>

        <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-4">
          <Field label={t('fromMonth')} hint={t('fromMonthHint')}>
            <MonthSelect
              value={month}
              onChange={setMonth}
              months={monthOptions(currentMonth(), 6)}
            />
          </Field>
          <Checkbox
            label={t('customFee')}
            checked={custom}
            onChange={(e) => setCustom(e.target.checked)}
          />
          {custom ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                label={t('customFeeAmount')}
                hint={t('customFeeHint')}
                error={formError === 'amountInvalid' ? tErrors('amountInvalid') : undefined}
              >
                <Input
                  inputMode="decimal"
                  autoComplete="off"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                />
              </Field>
              <Field
                label={t('reason')}
                hint={t('reasonHint')}
                error={formError === 'reasonRequired' ? tErrors('reasonRequired') : undefined}
              >
                <Input
                  maxLength={200}
                  autoComplete="off"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                />
              </Field>
            </div>
          ) : null}
          {failure ? <FormAlert>{tAll(failure)}</FormAlert> : null}
          <Footer
            busy={busy}
            cancel={t('cancel')}
            confirm={t('confirm')}
            disabled={chosen.size === 0}
            onCancel={close}
          />
        </form>
      </div>
    </Dialog>
  );
}

// ---- change the fee (CLS-04) -----------------------------------------------------------------

export function FeeDialog({
  student,
  classFeeCents,
  onClose,
}: {
  student: ClassStudent | null;
  classFeeCents: number;
  onClose: () => void;
}) {
  const t = useTranslations('classes.students.fee');
  const tErrors = useTranslations('classes.students.errors');
  const tAll = useTranslations('classes.errors');
  const router = useRouter();
  const { toast } = useToast();
  // The parent re-creates this dialog (`key`) for each student, so the fields start from the
  // student's current override.
  const [amount, setAmount] = useState(
    student?.feeOverrideCents == null ? '' : rupeesText(student.feeOverrideCents),
  );
  const [reason, setReason] = useState(student?.reason ?? '');
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<ActionError | null>(null);
  const [formError, setFormError] = useState<'amountInvalid' | 'reasonRequired' | null>(null);

  async function save(
    body: { feeOverrideCents: number | null; reason: string | null },
    done: 'saved' | 'cleared',
  ) {
    if (!student) return;
    setBusy(true);
    setFailure(null);
    try {
      await createBrowserApi().api.call('updateEnrollment', body, {
        params: { id: student.enrollmentId },
      });
      toast({ tone: 'success', title: t(done, { name: student.displayName }) });
      onClose();
      router.refresh();
    } catch (err) {
      setFailure(actionError(err));
    } finally {
      setBusy(false);
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    setFormError(null);
    const cents = parseRupees(amount);
    if (cents === null || feeProblem(amount)) return setFormError('amountInvalid');
    if (reason.trim() === '') return setFormError('reasonRequired');
    void save({ feeOverrideCents: cents, reason: reason.trim() }, 'saved');
  }

  return (
    <Dialog
      open={student !== null}
      onClose={onClose}
      busy={busy}
      title={t('title', { name: student?.displayName ?? '' })}
      description={t('body', { fee: formatFee(classFeeCents) })}
    >
      <form onSubmit={submit} className="flex flex-col gap-4">
        <Field
          label={t('amount')}
          hint={t('amountHint')}
          error={formError === 'amountInvalid' ? tErrors('amountInvalid') : undefined}
        >
          <Input
            inputMode="decimal"
            autoComplete="off"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </Field>
        <Field
          label={t('reason')}
          hint={t('reasonHint')}
          error={formError === 'reasonRequired' ? tErrors('reasonRequired') : undefined}
        >
          <Input
            maxLength={200}
            autoComplete="off"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </Field>
        {failure ? <FormAlert>{tAll(failure)}</FormAlert> : null}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="secondary" disabled={busy} onClick={onClose}>
            {t('cancel')}
          </Button>
          {student?.feeOverrideCents !== null && student ? (
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() => void save({ feeOverrideCents: null, reason: null }, 'cleared')}
            >
              {t('useClassFee')}
            </Button>
          ) : null}
          <Button type="submit" loading={busy}>
            {t('confirm')}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

// ---- move to another class (CLS-04) ----------------------------------------------------------

export function MoveDialog({
  student,
  classes,
  onClose,
}: {
  student: ClassStudent | null;
  /** Classes the student can move to (not this one, not archived). */
  classes: readonly ClassOption[];
  onClose: () => void;
}) {
  const t = useTranslations('classes.students.moveDialog');
  const tErrors = useTranslations('classes.students.errors');
  const tAll = useTranslations('classes.errors');
  const router = useRouter();
  const { toast } = useToast();
  const [to, setTo] = useState('');
  const [month, setMonth] = useState(currentMonth());
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<ActionError | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!student || !to) return;
    setBusy(true);
    setFailure(null);
    try {
      await createBrowserApi().api.call(
        'moveEnrollment',
        { toClassId: to, fromMonth: month },
        { params: { id: student.enrollmentId } },
      );
      toast({
        tone: 'success',
        title: t('done', {
          name: student.displayName,
          class: classes.find((c) => c.id === to)?.name ?? '',
        }),
      });
      setTo('');
      onClose();
      router.refresh();
    } catch (err) {
      setFailure(actionError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={student !== null}
      onClose={onClose}
      busy={busy}
      title={t('title', { name: student?.displayName ?? '' })}
      description={t('body')}
    >
      <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-4">
        <Field label={t('to')}>
          <Select value={to} onChange={(e) => setTo(e.target.value)} required>
            <option value="">{t('choose')}</option>
            {classes.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('fromMonth')} hint={t('fromMonthHint')}>
          <MonthSelect value={month} onChange={setMonth} months={monthOptions(currentMonth(), 6)} />
        </Field>
        {failure ? (
          <FormAlert>{failure === 'conflict' ? tErrors('conflict') : tAll(failure)}</FormAlert>
        ) : null}
        <Footer
          busy={busy}
          cancel={t('cancel')}
          confirm={t('confirm')}
          disabled={!to}
          onCancel={onClose}
        />
      </form>
    </Dialog>
  );
}

// ---- end the enrolment (CLS-04) --------------------------------------------------------------

export function EndDialog({
  student,
  onClose,
}: {
  student: ClassStudent | null;
  onClose: () => void;
}) {
  const t = useTranslations('classes.students.endDialog');
  const tAll = useTranslations('classes.errors');
  const format = useFormatter();
  const router = useRouter();
  const { toast } = useToast();
  const [month, setMonth] = useState(currentMonth());
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<ActionError | null>(null);

  // Last month attended: from the month the enrolment started (or last month, if later).
  const start = student
    ? maxMonth(student.fromMonth, previousMonth(currentMonth()))
    : currentMonth();
  const months = monthOptions(start, 8);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!student) return;
    const last = months.includes(month) ? month : (months[0] ?? month);
    setBusy(true);
    setFailure(null);
    try {
      await createBrowserApi().api.call(
        'updateEnrollment',
        { toMonth: last },
        { params: { id: student.enrollmentId } },
      );
      toast({
        tone: 'success',
        title: t('done', {
          name: student.displayName,
          month: format.dateTime(monthDate(last), { month: 'long', year: 'numeric' }),
        }),
      });
      onClose();
      router.refresh();
    } catch (err) {
      setFailure(actionError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={student !== null}
      onClose={onClose}
      busy={busy}
      title={t('title', { name: student?.displayName ?? '' })}
      description={t('body')}
    >
      <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-4">
        <Field label={t('lastMonth')}>
          <MonthSelect
            value={months.includes(month) ? month : (months[0] ?? month)}
            onChange={setMonth}
            months={months}
          />
        </Field>
        {failure ? <FormAlert>{tAll(failure)}</FormAlert> : null}
        <Footer busy={busy} cancel={t('cancel')} confirm={t('confirm')} onCancel={onClose} />
      </form>
    </Dialog>
  );
}

const maxMonth = (a: string, b: string): string => (a > b ? a : b);

/** `2026-10-01` → `2026-09-01`. */
function previousMonth(month: string): string {
  const [y = 0, m = 1] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 2, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-01`;
}
