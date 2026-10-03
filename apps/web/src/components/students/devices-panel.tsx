'use client';

import {
  Button,
  ConfirmDialog,
  DataTable,
  EmptyState,
  useToast,
  type DataTableColumn,
} from '@remix/ui';
import type { StudentProfile } from '@remix/types/api';
import { KeyRound, LogOut, MonitorSmartphone } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useFormatter, useTranslations } from 'next-intl';
import { useState } from 'react';
import { createBrowserApi } from '@/lib/browser-api';
import { actionError, DEVICE_LIMIT } from '@/lib/people';

type Device = StudentProfile['devices'][number];
type Confirm = { kind: 'device'; device: Device } | { kind: 'all' } | { kind: 'reset' } | null;

/**
 * Devices tab (12c): the devices the student is signed in on (limit 2, AUTH-03), with sign out
 * per device or for all (AUTH-08), and a password reset that texts the student a code. Only shown
 * to roles with `students.devices`; the API checks it again. Those endpoints belong to the
 * auth track; until they ship, a failed call shows the generic error.
 */
export function DevicesPanel({
  studentId,
  name,
  devices,
}: {
  studentId: string;
  name: string;
  devices: readonly Device[];
}) {
  const t = useTranslations('students.devices');
  const tErrors = useTranslations('students.errors');
  const format = useFormatter();
  const router = useRouter();
  const { toast } = useToast();
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [busy, setBusy] = useState(false);

  async function run() {
    if (!confirm) return;
    setBusy(true);
    const { api } = createBrowserApi();
    try {
      if (confirm.kind === 'device') {
        await api.call('signOutStudentDevice', {
          params: { id: studentId, deviceId: confirm.device.id },
        });
        toast({ tone: 'success', title: t('signedOutOne') });
      } else if (confirm.kind === 'all') {
        await api.call('bulkStudents', { action: 'sign_out_devices', studentIds: [studentId] });
        toast({ tone: 'success', title: t('signedOutAll') });
      } else {
        await api.call('resetStudentPassword', { params: { id: studentId } });
        toast({ tone: 'success', title: t('resetSent', { name }) });
      }
      setConfirm(null);
      router.refresh();
    } catch (err) {
      toast({ tone: 'danger', title: tErrors(actionError(err)) });
      setConfirm(null);
    } finally {
      setBusy(false);
    }
  }

  const columns: DataTableColumn<Device>[] = [
    { id: 'device', header: t('columns.device'), cell: (d) => d.label, rowHeader: true },
    {
      id: 'since',
      header: t('columns.firstSeen'),
      cell: (d) =>
        format.dateTime(new Date(d.firstSeenAt), {
          day: 'numeric',
          month: 'short',
          year: 'numeric',
        }),
    },
    {
      id: 'last',
      header: t('columns.lastUsed'),
      cell: (d) =>
        format.dateTime(new Date(d.lastSeenAt), {
          day: 'numeric',
          month: 'short',
          hour: 'numeric',
          minute: '2-digit',
        }),
    },
    {
      id: 'action',
      header: t('columns.actions'),
      hideHeader: true,
      align: 'end',
      cell: (d) => (
        <Button
          variant="secondary"
          size="sm"
          onClick={() => setConfirm({ kind: 'device', device: d })}
          aria-label={t('signOutDevice', { device: d.label })}
        >
          <LogOut aria-hidden size={16} />
          {t('signOut')}
        </Button>
      ),
    },
  ];

  const title =
    confirm?.kind === 'reset'
      ? t('confirm.reset.title', { name })
      : confirm?.kind === 'all'
        ? t('confirm.all.title')
        : t('confirm.one.title', {
            device: confirm?.kind === 'device' ? confirm.device.label : '',
          });
  const body =
    confirm?.kind === 'reset'
      ? t('confirm.reset.body')
      : confirm?.kind === 'all'
        ? t('confirm.all.body')
        : t('confirm.one.body');

  return (
    <section className="flex flex-col gap-4" aria-labelledby="devices-heading">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="devices-heading" className="m-0 text-base font-semibold">
          {t('heading', { count: devices.length, limit: DEVICE_LIMIT })}
        </h2>
        <div className="flex flex-wrap gap-2">
          {devices.length > 0 ? (
            <Button variant="secondary" onClick={() => setConfirm({ kind: 'all' })}>
              <LogOut aria-hidden size={16} />
              {t('signOutAll')}
            </Button>
          ) : null}
          <Button variant="secondary" onClick={() => setConfirm({ kind: 'reset' })}>
            <KeyRound aria-hidden size={16} />
            {t('resetPassword')}
          </Button>
        </div>
      </div>
      <div className="bg-surface border-line overflow-hidden rounded-lg border">
        <DataTable
          caption={t('caption')}
          columns={columns}
          rows={devices}
          rowKey={(d) => d.id}
          empty={
            <EmptyState
              size="compact"
              icon={<MonitorSmartphone />}
              title={t('empty.title')}
              description={t('empty.body')}
            />
          }
        />
      </div>
      <ConfirmDialog
        open={confirm !== null}
        variant={confirm?.kind === 'reset' ? 'default' : 'destructive'}
        title={title}
        description={body}
        confirmLabel={confirm?.kind === 'reset' ? t('confirm.reset.confirm') : t('signOut')}
        cancelLabel={t('confirm.cancel')}
        confirming={busy}
        onCancel={() => setConfirm(null)}
        onConfirm={() => void run()}
      />
    </section>
  );
}
