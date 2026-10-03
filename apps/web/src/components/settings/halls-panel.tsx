'use client';

import {
  Button,
  ConfirmDialog,
  DataTable,
  EmptyState,
  Field,
  Input,
  useToast,
  type DataTableColumn,
} from '@remix/ui';
import { hallInputSchema, type Hall } from '@remix/types/api';
import { DoorOpen, Pencil, Plus, Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useFormatter, useTranslations } from 'next-intl';
import { useState, type FormEvent } from 'react';
import { FormAlert } from '@/components/form-alert';
import { Dialog } from '@/components/people/dialog';
import { createBrowserApi } from '@/lib/browser-api';
import { actionError, type ActionError } from '@/lib/people';

/**
 * Settings → Halls (CLS-05): add, rename and delete the rooms classes meet in. Deleting a hall a
 * class still uses is refused by the API (409); the person is told which step to take next.
 */
export function HallsPanel({ halls, canWrite }: { halls: readonly Hall[]; canWrite: boolean }) {
  const t = useTranslations('settings.halls');
  const tErrors = useTranslations('settings.errors');
  const format = useFormatter();
  const router = useRouter();
  const { toast } = useToast();
  const [editing, setEditing] = useState<Hall | 'new' | null>(null);
  const [deleting, setDeleting] = useState<Hall | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  async function remove(hall: Hall) {
    setDeleteBusy(true);
    try {
      await createBrowserApi().api.call('deleteHall', { params: { id: hall.id } });
      toast({ tone: 'success', title: t('toasts.deleted', { name: hall.name }) });
      router.refresh();
    } catch (err) {
      toast({
        tone: 'danger',
        title:
          actionError(err) === 'conflict'
            ? t('toasts.inUse', { name: hall.name })
            : tErrors(actionError(err)),
      });
    } finally {
      setDeleteBusy(false);
      setDeleting(null);
    }
  }

  const columns: DataTableColumn<Hall>[] = [
    { id: 'name', header: t('columns.name'), rowHeader: true, cell: (h) => h.name },
    {
      id: 'capacity',
      header: t('columns.capacity'),
      align: 'end',
      cell: (h) =>
        h.capacity === null
          ? t('noCapacity')
          : t('capacityValue', { count: format.number(h.capacity) }),
    },
    ...(canWrite
      ? [
          {
            id: 'actions',
            header: t('columns.actions'),
            hideHeader: true,
            align: 'end',
            cell: (h: Hall) => (
              <span className="inline-flex gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={t('edit', { name: h.name })}
                  onClick={() => setEditing(h)}
                >
                  <Pencil aria-hidden size={16} />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={t('delete', { name: h.name })}
                  onClick={() => setDeleting(h)}
                >
                  <Trash2 aria-hidden size={16} />
                </Button>
              </span>
            ),
          } satisfies DataTableColumn<Hall>,
        ]
      : []),
  ];

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-muted m-0 text-sm">{t('count', { count: halls.length })}</p>
        {canWrite ? (
          <Button onClick={() => setEditing('new')}>
            <Plus aria-hidden size={16} />
            {t('add')}
          </Button>
        ) : (
          <p className="text-muted m-0 text-sm">{t('readOnly')}</p>
        )}
      </div>

      <div className="bg-surface border-line overflow-hidden rounded-lg border">
        <DataTable
          caption={t('tableCaption')}
          columns={columns}
          rows={halls}
          rowKey={(h) => h.id}
          empty={
            <EmptyState
              size="compact"
              icon={<DoorOpen />}
              title={t('empty.title')}
              description={t('empty.body')}
            />
          }
        />
      </div>

      <HallDialog
        key={editing === null ? 'closed' : editing === 'new' ? 'new' : editing.id}
        hall={editing}
        onClose={() => setEditing(null)}
      />
      <ConfirmDialog
        open={deleting !== null}
        variant="destructive"
        title={t('deleteDialog.title', { name: deleting?.name ?? '' })}
        description={t('deleteDialog.body')}
        confirmLabel={t('deleteDialog.confirm')}
        cancelLabel={t('deleteDialog.cancel')}
        confirming={deleteBusy}
        onCancel={() => setDeleting(null)}
        onConfirm={() => {
          if (deleting) void remove(deleting);
        }}
      />
    </section>
  );
}

function HallDialog({ hall, onClose }: { hall: Hall | 'new' | null; onClose: () => void }) {
  const t = useTranslations('settings.halls');
  const tErrors = useTranslations('settings.errors');
  const router = useRouter();
  const { toast } = useToast();
  const existing = hall === null || hall === 'new' ? null : hall;
  const [name, setName] = useState(existing?.name ?? '');
  const [capacity, setCapacity] = useState(existing?.capacity?.toString() ?? '');
  const [error, setError] = useState<'nameRequired' | 'capacityInvalid' | 'nameTaken' | null>(null);
  const [failure, setFailure] = useState<ActionError | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setFailure(null);
    const digits = capacity.trim();
    const parsed = hallInputSchema.safeParse({
      name,
      capacity: digits === '' ? null : /^\d+$/.test(digits) ? Number(digits) : Number.NaN,
    });
    if (!parsed.success) {
      const field = parsed.error.issues[0]?.path[0];
      setError(field === 'capacity' ? 'capacityInvalid' : 'nameRequired');
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const { api } = createBrowserApi();
      const saved = existing
        ? await api.call('updateHall', parsed.data, { params: { id: existing.id } })
        : await api.call('createHall', parsed.data);
      toast({
        tone: 'success',
        title: t(existing ? 'toasts.saved' : 'toasts.added', { name: saved.name }),
      });
      onClose();
      router.refresh();
    } catch (err) {
      const code = actionError(err);
      if (code === 'conflict') setError('nameTaken');
      else setFailure(code);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={hall !== null}
      onClose={onClose}
      busy={busy}
      title={existing ? t('form.titleEdit') : t('form.titleNew')}
    >
      <form noValidate onSubmit={(e) => void submit(e)} className="flex flex-col gap-4">
        <Field
          label={t('name')}
          error={
            error === 'nameRequired' || error === 'nameTaken'
              ? t(`form.errors.${error}`)
              : undefined
          }
        >
          <Input
            value={name}
            maxLength={60}
            autoComplete="off"
            onChange={(e) => setName(e.target.value)}
          />
        </Field>
        <Field
          label={t('capacity')}
          hint={t('capacityHint')}
          optional={t('optional')}
          error={error === 'capacityInvalid' ? t('form.errors.capacityInvalid') : undefined}
        >
          <Input
            inputMode="numeric"
            value={capacity}
            autoComplete="off"
            onChange={(e) => setCapacity(e.target.value)}
          />
        </Field>
        {failure ? <FormAlert>{tErrors(failure)}</FormAlert> : null}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="secondary" disabled={busy} onClick={onClose}>
            {t('form.cancel')}
          </Button>
          <Button type="submit" loading={busy}>
            {busy ? t('form.saving') : t('form.save')}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
