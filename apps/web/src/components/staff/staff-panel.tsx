'use client';

import {
  Button,
  ConfirmDialog,
  DataTable,
  EmptyState,
  StatCard,
  StatusBadge,
  useToast,
  type DataTableColumn,
} from '@remix/ui';
import type { AdminClass, StaffMember, StaffResponse } from '@remix/types/api';
import { Ban, MailX, Pencil, RotateCcw, UserPlus, Users } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useFormatter, useTranslations } from 'next-intl';
import { useState } from 'react';
import { createBrowserApi } from '@/lib/browser-api';
import { actionError, formatPhone, needsTwoStep, STAFF_STATUS_TONE } from '@/lib/people';
import { EditDialog } from './edit-dialog';
import { InviteDialog } from './invite-dialog';

type ClassOption = Pick<AdminClass, 'id' | 'name'>;
type Pending =
  | { kind: 'revoke'; member: StaffMember }
  | { kind: 'disable'; member: StaffMember }
  | { kind: 'enable'; member: StaffMember }
  | null;

/**
 * Settings → Staff and roles (STF-01/02/03): who can do what, plan seats in use, invitations
 * and the 2-step status of each role. Owners only (`staff.manage`); the page already refused
 * everyone else. Actions never apply to your own row, so nobody locks themselves out.
 */
export function StaffPanel({
  data,
  classes,
  currentUserId,
}: {
  data: StaffResponse;
  classes: readonly ClassOption[];
  currentUserId: string;
}) {
  const t = useTranslations('staff');
  const tRoles = useTranslations('staff.roles');
  const tStatus = useTranslations('staff.status');
  const tErrors = useTranslations('staff.errors');
  const format = useFormatter();
  const router = useRouter();
  const { toast } = useToast();

  const [inviting, setInviting] = useState(false);
  const [editing, setEditing] = useState<StaffMember | null>(null);
  const [pending, setPending] = useState<Pending>(null);
  const [busy, setBusy] = useState(false);

  const className = (id: string) => classes.find((c) => c.id === id)?.name;

  async function confirm() {
    if (!pending) return;
    setBusy(true);
    const { api } = createBrowserApi();
    try {
      if (pending.kind === 'revoke') {
        await api.call('revokeInvite', { params: { id: pending.member.id } });
      } else {
        await api.call(
          'updateStaff',
          { status: pending.kind === 'disable' ? 'disabled' : 'active' },
          { params: { id: pending.member.id } },
        );
      }
      toast({
        tone: 'success',
        title: t(`confirm.${pending.kind}.done`, { name: pending.member.displayName }),
      });
      setPending(null);
      router.refresh();
    } catch (err) {
      toast({ tone: 'danger', title: tErrors(actionError(err)) });
      setPending(null);
    } finally {
      setBusy(false);
    }
  }

  const columns: DataTableColumn<StaffMember>[] = [
    {
      id: 'name',
      header: t('columns.name'),
      rowHeader: true,
      wrap: true,
      cell: (m) => (
        <span className="flex flex-col">
          <span>
            {m.displayName}
            {m.id === currentUserId ? (
              <span className="text-muted font-normal"> ({t('you')})</span>
            ) : null}
          </span>
          <span className="text-muted text-xs font-normal">
            {[m.phone ? formatPhone(m.phone) : null, m.email].filter(Boolean).join(' · ')}
          </span>
        </span>
      ),
    },
    {
      id: 'roles',
      header: t('columns.role'),
      wrap: true,
      cell: (m) =>
        format.list(
          m.roles.map((r) => tRoles(r)),
          { type: 'conjunction' },
        ),
    },
    {
      id: 'classes',
      header: t('columns.classes'),
      wrap: true,
      cell: (m) => {
        if (!m.roles.includes('teacher')) return '—';
        const names = m.classScope.map((id) => className(id)).filter((n): n is string => !!n);
        return names.length > 0 ? names.join(', ') : t('ownClasses');
      },
    },
    {
      id: 'status',
      header: t('columns.status'),
      cell: (m) => (
        <span className="flex flex-col items-start gap-1">
          <StatusBadge tone={STAFF_STATUS_TONE[m.status]}>{tStatus(m.status)}</StatusBadge>
          {m.status === 'invited' && m.inviteExpiresAt ? (
            <span className="text-muted text-xs">
              {t('expires', {
                date: format.dateTime(new Date(m.inviteExpiresAt), {
                  day: 'numeric',
                  month: 'short',
                  hour: 'numeric',
                  minute: '2-digit',
                }),
              })}
            </span>
          ) : null}
        </span>
      ),
    },
    {
      id: 'twoStep',
      header: t('columns.twoStep'),
      cell: (m) =>
        needsTwoStep(m.roles) ? (
          <StatusBadge tone="success">{t('twoStep.required')}</StatusBadge>
        ) : (
          <span className="text-muted">{t('twoStep.notRequired')}</span>
        ),
    },
    {
      id: 'lastSignIn',
      header: t('columns.lastSignIn'),
      cell: (m) =>
        m.lastSignInAt
          ? format.dateTime(new Date(m.lastSignInAt), {
              day: 'numeric',
              month: 'short',
              hour: 'numeric',
              minute: '2-digit',
            })
          : '—',
    },
    {
      id: 'actions',
      header: t('columns.actions'),
      hideHeader: true,
      align: 'end',
      cell: (m) => {
        if (m.id === currentUserId) return null;
        if (m.status === 'invited') {
          return (
            <Button
              variant="secondary"
              size="sm"
              aria-label={t('actions.revokeFor', { name: m.displayName })}
              onClick={() => setPending({ kind: 'revoke', member: m })}
            >
              <MailX aria-hidden size={16} />
              {t('actions.revoke')}
            </Button>
          );
        }
        return (
          <span className="inline-flex gap-2">
            <Button
              variant="secondary"
              size="sm"
              aria-label={t('actions.editFor', { name: m.displayName })}
              onClick={() => setEditing(m)}
            >
              <Pencil aria-hidden size={16} />
              {t('actions.edit')}
            </Button>
            {m.status === 'active' ? (
              <Button
                variant="secondary"
                size="sm"
                aria-label={t('actions.disableFor', { name: m.displayName })}
                onClick={() => setPending({ kind: 'disable', member: m })}
              >
                <Ban aria-hidden size={16} />
                {t('actions.disable')}
              </Button>
            ) : (
              <Button
                variant="secondary"
                size="sm"
                aria-label={t('actions.enableFor', { name: m.displayName })}
                onClick={() => setPending({ kind: 'enable', member: m })}
              >
                <RotateCcw aria-hidden size={16} />
                {t('actions.enable')}
              </Button>
            )}
          </span>
        );
      },
    },
  ];

  const { teachers, cashiers } = data.usage;
  const seat = (u: { used: number; limit: number | null }) =>
    u.limit === null
      ? t('usage.unlimited', { used: u.used })
      : t('usage.of', { used: u.used, limit: u.limit });

  return (
    <div className="flex flex-col gap-6">
      <section aria-label={t('usage.label')} className="grid gap-3 sm:grid-cols-2">
        <StatCard
          label={t('usage.teachers')}
          value={seat(teachers)}
          detail={
            teachers.limit !== null && teachers.used >= teachers.limit
              ? { text: t('usage.full'), tone: 'warning' }
              : undefined
          }
        />
        <StatCard
          label={t('usage.cashiers')}
          value={seat(cashiers)}
          detail={
            cashiers.limit !== null && cashiers.used >= cashiers.limit
              ? { text: t('usage.full'), tone: 'warning' }
              : undefined
          }
        />
      </section>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="m-0 text-base font-semibold">{t('tableHeading')}</h2>
        <Button onClick={() => setInviting(true)}>
          <UserPlus aria-hidden size={18} />
          {t('inviteButton')}
        </Button>
      </div>

      <div className="bg-surface border-line overflow-hidden rounded-lg border">
        <DataTable
          caption={t('tableCaption')}
          columns={columns}
          rows={data.items}
          rowKey={(m) => m.id}
          empty={
            <EmptyState
              size="compact"
              icon={<Users />}
              title={t('empty.title')}
              description={t('empty.body')}
            />
          }
        />
      </div>

      <InviteDialog open={inviting} classes={classes} onClose={() => setInviting(false)} />
      <EditDialog
        key={editing?.id ?? 'none'}
        member={editing}
        classes={classes}
        onClose={() => setEditing(null)}
      />
      <ConfirmDialog
        open={pending !== null}
        variant={pending?.kind === 'enable' ? 'default' : 'destructive'}
        title={
          pending ? t(`confirm.${pending.kind}.title`, { name: pending.member.displayName }) : ''
        }
        description={pending ? t(`confirm.${pending.kind}.body`) : undefined}
        confirmLabel={pending ? t(`confirm.${pending.kind}.confirm`) : ''}
        cancelLabel={t('confirm.cancel')}
        confirming={busy}
        onCancel={() => setPending(null)}
        onConfirm={() => void confirm()}
      />
    </div>
  );
}
