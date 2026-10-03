'use client';

import {
  Button,
  ConfirmDialog,
  DataTable,
  EmptyState,
  Field,
  StatusBadge,
  useToast,
  type DataTableColumn,
} from '@remix/ui';
import type { AdminClass, BulkStudentAction, StudentListItem } from '@remix/types/api';
import { LogOut, MoveRight, RotateCcw, Archive, Users, X } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useFormatter, useTranslations } from 'next-intl';
import { useState } from 'react';
import { Dialog } from '@/components/people/dialog';
import { Select } from '@/components/people/select';
import { createBrowserApi } from '@/lib/browser-api';
import { ADMIN_PATHS } from '@/lib/paths';
import {
  actionError,
  currentMonth,
  DEVICE_LIMIT,
  formatPhone,
  monthDate,
  monthOptions,
  STATUS_TONE,
} from '@/lib/people';

type ClassOption = Pick<AdminClass, 'id' | 'name'>;
type Action = 'moveClass' | 'signOut' | 'archive' | 'reactivate';

/**
 * Students table (STU-01) with row selection and the bulk actions bar (STU-02, STU-07).
 * What the person may do comes from the server (`canWrite`, `canDevices`, from `can()`); the API
 * enforces the same rules. Selection lives only on the current page.
 */
export function StudentsTable({
  items,
  classes,
  canWrite,
  canDevices,
  archivedView,
  filtered,
  clearHref,
}: {
  items: readonly StudentListItem[];
  classes: readonly ClassOption[];
  canWrite: boolean;
  canDevices: boolean;
  /** Showing archived students: offer Reactivate instead of Archive. */
  archivedView: boolean;
  filtered: boolean;
  clearHref: string;
}) {
  const t = useTranslations('students.list');
  const tStatus = useTranslations('students.status');
  const format = useFormatter();
  const router = useRouter();

  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [pending, setPending] = useState<Action | null>(null);
  const [running, setRunning] = useState(false);
  const { toast } = useToast();
  const tBulk = useTranslations('students.bulk');
  const tErrors = useTranslations('students.errors');

  // Selection may only hold rows that are still on the page (after a refresh or a page change).
  const ids = new Set(items.map((i) => i.id));
  const chosen = [...selected].filter((id) => ids.has(id));
  const allChosen = items.length > 0 && chosen.length === items.length;

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  const toggleAll = () => setSelected(allChosen ? new Set() : new Set(items.map((i) => i.id)));

  async function run(
    action: BulkStudentAction,
    done: 'archive' | 'reactivate' | 'signOut' | 'moveClass',
  ) {
    setRunning(true);
    try {
      const { api } = createBrowserApi();
      const result = await api.call('bulkStudents', action);
      toast({
        tone: result.affected > 0 ? 'success' : 'warning',
        title: tBulk(`done.${done}`, { count: result.affected }),
        description:
          result.skipped.length > 0
            ? tBulk('skipped', { count: result.skipped.length })
            : undefined,
      });
      setSelected(new Set());
      setPending(null);
      router.refresh();
    } catch (err) {
      toast({ tone: 'danger', title: tErrors(actionError(err)) });
      setPending(null);
    } finally {
      setRunning(false);
    }
  }

  const columns: DataTableColumn<StudentListItem>[] = [
    ...(canWrite
      ? [
          {
            id: 'select',
            header: (
              <RowCheckbox
                label={t('selectAll')}
                checked={allChosen}
                indeterminate={chosen.length > 0 && !allChosen}
                onChange={toggleAll}
              />
            ),
            cell: (s: StudentListItem) => (
              <RowCheckbox
                label={t('selectOne', { name: s.displayName })}
                checked={selected.has(s.id)}
                onChange={() => toggle(s.id)}
              />
            ),
            className: 'w-11',
          } satisfies DataTableColumn<StudentListItem>,
        ]
      : []),
    { id: 'name', header: t('columns.name'), cell: (s) => s.displayName, rowHeader: true },
    { id: 'studentNo', header: t('columns.studentNo'), cell: (s) => s.studentNo },
    { id: 'phone', header: t('columns.phone'), cell: (s) => formatPhone(s.phone) },
    {
      id: 'classes',
      header: t('columns.classes'),
      cell: (s) =>
        s.classNames.length === 0 ? (
          <span aria-label={t('noClasses')}>—</span>
        ) : (
          <span
            title={s.classNames.join(', ')}
            className="inline-block max-w-48 truncate align-middle"
          >
            {s.classNames.length === 1
              ? s.classNames[0]
              : t('classCount', { count: s.classNames.length })}
          </span>
        ),
    },
    {
      id: 'status',
      header: t('columns.status'),
      cell: (s) => <StatusBadge tone={STATUS_TONE[s.status]}>{tStatus(s.status)}</StatusBadge>,
    },
    {
      id: 'devices',
      header: t('columns.devices'),
      cell: (s) => t('devicesValue', { count: s.activeDevices, limit: DEVICE_LIMIT }),
    },
    {
      id: 'joined',
      header: t('columns.joined'),
      cell: (s) =>
        format.dateTime(new Date(s.joinedAt), { day: 'numeric', month: 'short', year: 'numeric' }),
    },
  ];

  const count = { count: chosen.length };
  const confirmTexts = {
    signOut: {
      variant: 'default' as const,
      title: tBulk('signOutConfirm.title', count),
      body: tBulk('signOutConfirm.body', count),
      confirm: tBulk('signOutConfirm.confirm'),
    },
    archive: {
      variant: 'destructive' as const,
      title: tBulk('archiveConfirm.title', count),
      body: tBulk('archiveConfirm.body', count),
      confirm: tBulk('archiveConfirm.confirm'),
    },
    reactivate: {
      variant: 'default' as const,
      title: tBulk('reactivateConfirm.title', count),
      body: tBulk('reactivateConfirm.body', count),
      confirm: tBulk('reactivateConfirm.confirm'),
    },
  };
  const confirming = pending && pending !== 'moveClass' ? confirmTexts[pending] : null;

  return (
    <div className="flex flex-col gap-3">
      {chosen.length > 0 ? (
        <section
          aria-label={tBulk('region')}
          className="bg-brand-soft border-brand-line text-ink flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2 lg:px-4"
        >
          <p role="status" className="m-0 mr-auto text-sm font-semibold">
            {tBulk('selected', { count: chosen.length })}
          </p>
          {canWrite && classes.length > 0 ? (
            <Button variant="secondary" size="sm" onClick={() => setPending('moveClass')}>
              <MoveRight aria-hidden size={16} />
              {tBulk('moveClass')}
            </Button>
          ) : null}
          {canDevices ? (
            <Button variant="secondary" size="sm" onClick={() => setPending('signOut')}>
              <LogOut aria-hidden size={16} />
              {tBulk('signOut')}
            </Button>
          ) : null}
          {canWrite && !archivedView ? (
            <Button variant="secondary" size="sm" onClick={() => setPending('archive')}>
              <Archive aria-hidden size={16} />
              {tBulk('archive')}
            </Button>
          ) : null}
          {canWrite && archivedView ? (
            <Button variant="secondary" size="sm" onClick={() => setPending('reactivate')}>
              <RotateCcw aria-hidden size={16} />
              {tBulk('reactivate')}
            </Button>
          ) : null}
          <Button variant="ghost" size="sm" onClick={() => setSelected(new Set())}>
            <X aria-hidden size={16} />
            {tBulk('clear')}
          </Button>
        </section>
      ) : null}

      <div className="bg-surface border-line overflow-hidden rounded-lg border">
        <DataTable
          caption={t('tableCaption')}
          columns={columns}
          rows={items}
          rowKey={(s) => s.id}
          rowHref={(s) => `${ADMIN_PATHS.students}/${s.id}`}
          linkComponent={Link}
          stickyHeader
          rowClassName={(s) => (selected.has(s.id) ? 'bg-brand-soft' : undefined)}
          empty={
            filtered ? (
              <EmptyState
                size="compact"
                icon={<Users />}
                title={t('emptyFiltered.title')}
                description={t('emptyFiltered.body')}
                action={
                  <Link href={clearHref} className="text-brand text-sm font-medium underline">
                    {t('emptyFiltered.clear')}
                  </Link>
                }
              />
            ) : (
              <EmptyState
                size="compact"
                icon={<Users />}
                title={t('empty.title')}
                description={t('empty.body')}
              />
            )
          }
        />
      </div>

      <ConfirmDialog
        open={confirming !== null}
        variant={confirming?.variant ?? 'default'}
        title={confirming?.title ?? ''}
        description={confirming?.body}
        confirmLabel={confirming?.confirm ?? ''}
        cancelLabel={tBulk('cancel')}
        confirming={running}
        onCancel={() => setPending(null)}
        onConfirm={() => {
          if (pending === 'signOut') {
            void run({ action: 'sign_out_devices', studentIds: chosen }, 'signOut');
          } else if (pending === 'archive') {
            void run({ action: 'archive', studentIds: chosen }, 'archive');
          } else if (pending === 'reactivate') {
            void run({ action: 'reactivate', studentIds: chosen }, 'reactivate');
          }
        }}
      />

      <MoveClassDialog
        open={pending === 'moveClass'}
        count={chosen.length}
        classes={classes}
        busy={running}
        onClose={() => setPending(null)}
        onMove={(fromClassId, toClassId, fromMonth) =>
          run(
            { action: 'move_class', studentIds: chosen, fromClassId, toClassId, fromMonth },
            'moveClass',
          )
        }
      />
    </div>
  );
}

/** A real checkbox in a 44 px target; `label` names it for screen readers. */
function RowCheckbox({
  label,
  checked,
  indeterminate = false,
  onChange,
}: {
  label: string;
  checked: boolean;
  indeterminate?: boolean;
  onChange: () => void;
}) {
  return (
    <label className="-my-2 -ml-1 flex size-11 cursor-pointer items-center justify-center">
      <span className="sr-only">{label}</span>
      <input
        type="checkbox"
        checked={checked}
        ref={(el) => {
          if (el) el.indeterminate = indeterminate;
        }}
        onChange={onChange}
        className="accent-brand size-5 cursor-pointer"
      />
    </label>
  );
}

function MoveClassDialog({
  open,
  count,
  classes,
  busy,
  onClose,
  onMove,
}: {
  open: boolean;
  count: number;
  classes: readonly ClassOption[];
  busy: boolean;
  onClose: () => void;
  onMove: (fromClassId: string, toClassId: string, fromMonth: string) => void;
}) {
  const t = useTranslations('students.bulk.move');
  const tBulk = useTranslations('students.bulk');
  const format = useFormatter();
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [month, setMonth] = useState(currentMonth());
  const invalid = !from || !to || from === to;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      busy={busy}
      title={t('title', { count })}
      description={t('body')}
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (!invalid) onMove(from, to, month);
        }}
      >
        <Field label={t('from')}>
          <Select value={from} onChange={(e) => setFrom(e.target.value)} required>
            <option value="">{t('choose')}</option>
            {classes.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('to')} error={from && to && from === to ? t('sameClass') : undefined}>
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
          <Select value={month} onChange={(e) => setMonth(e.target.value)}>
            {monthOptions(currentMonth(), 6).map((m) => (
              <option key={m} value={m}>
                {format.dateTime(monthDate(m), { month: 'long', year: 'numeric' })}
              </option>
            ))}
          </Select>
        </Field>
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="secondary" disabled={busy} onClick={onClose}>
            {tBulk('cancel')}
          </Button>
          <Button type="submit" loading={busy} disabled={invalid}>
            {t('confirm')}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
