'use client';

import { Button, Field, useToast } from '@remix/ui';
import { STAFF_ROLES, type AdminClass, type StaffMember, type StaffRole } from '@remix/types/api';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState, type FormEvent } from 'react';
import { FormAlert } from '@/components/form-alert';
import { Dialog } from '@/components/people/dialog';
import { Select } from '@/components/people/select';
import { createBrowserApi } from '@/lib/browser-api';
import { actionError, type ActionError } from '@/lib/people';
import { ClassPicker } from './invite-dialog';

type ClassOption = Pick<AdminClass, 'id' | 'name'>;

/**
 * Change a member's role and, for teachers, their classes (STF-01/02). The API refuses to demote
 * the last active owner and re-checks the plan's seats; both come back as readable errors here.
 * Saving a role replaces the member's roles with the chosen one.
 */
export function EditDialog({
  member,
  classes,
  onClose,
}: {
  member: StaffMember | null;
  classes: readonly ClassOption[];
  onClose: () => void;
}) {
  const t = useTranslations('staff.edit');
  const tRoles = useTranslations('staff.roles');
  const tErrors = useTranslations('staff.errors');
  const router = useRouter();
  const { toast } = useToast();
  const [role, setRole] = useState<StaffRole>(member?.roles[0] ?? 'teacher');
  const [scope, setScope] = useState<readonly string[]>(member?.classScope ?? []);
  const [failure, setFailure] = useState<ActionError | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!member) return;
    setFailure(null);
    setBusy(true);
    try {
      await createBrowserApi().api.call(
        'updateStaff',
        { role, ...(role === 'teacher' ? { classScope: [...scope] } : {}) },
        { params: { id: member.id } },
      );
      toast({ tone: 'success', title: t('saved', { name: member.displayName }) });
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
      open={member !== null}
      onClose={onClose}
      busy={busy}
      title={t('title', { name: member?.displayName ?? '' })}
      description={t('body')}
    >
      {/* Re-mount per member so its current role and classes are the starting values. */}
      <form
        key={member?.id}
        noValidate
        onSubmit={(e) => void submit(e)}
        className="flex flex-col gap-4"
      >
        <Field label={t('role')}>
          <Select value={role} onChange={(e) => setRole(e.target.value as StaffRole)}>
            {STAFF_ROLES.map((r) => (
              <option key={r} value={r}>
                {tRoles(r)}
              </option>
            ))}
          </Select>
        </Field>
        {role === 'teacher' ? (
          <ClassPicker classes={classes} value={scope} onChange={setScope} />
        ) : null}
        {failure ? <FormAlert>{tErrors(failure)}</FormAlert> : null}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="secondary" disabled={busy} onClick={onClose}>
            {t('cancel')}
          </Button>
          <Button type="submit" loading={busy}>
            {t('save')}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
