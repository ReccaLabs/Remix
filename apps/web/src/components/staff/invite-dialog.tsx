'use client';

import { Button, Checkbox, Field, Input, PhoneInput, useToast } from '@remix/ui';
import { inviteStaffSchema, STAFF_ROLES, type AdminClass, type StaffRole } from '@remix/types/api';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState, type FormEvent } from 'react';
import { FormAlert } from '@/components/form-alert';
import { Dialog } from '@/components/people/dialog';
import { Select } from '@/components/people/select';
import { createBrowserApi } from '@/lib/browser-api';
import { actionError, needsTwoStep, type ActionError } from '@/lib/people';

type ClassOption = Pick<AdminClass, 'id' | 'name'>;
type FieldName = 'displayName' | 'phone' | 'email';

/**
 * Invite staff (STF-01): name, phone and/or email, role and — for teachers — their classes
 * (STF-02). Roles that sign in with an SMS code need a phone number. The invitation link goes
 * out by SMS or email; this dialog never sees the token.
 */
export function InviteDialog({
  open,
  classes,
  onClose,
}: {
  open: boolean;
  classes: readonly ClassOption[];
  onClose: () => void;
}) {
  const t = useTranslations('staff.invite');
  const tRoles = useTranslations('staff.roles');
  const tErrors = useTranslations('staff.errors');
  const router = useRouter();
  const { toast } = useToast();

  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<StaffRole>('teacher');
  const [scope, setScope] = useState<readonly string[]>([]);
  const [issues, setIssues] = useState<Partial<Record<FieldName, string>>>({});
  const [failure, setFailure] = useState<ActionError | null>(null);
  const [busy, setBusy] = useState(false);

  function reset() {
    setName('');
    setPhone('');
    setEmail('');
    setRole('teacher');
    setScope([]);
    setIssues({});
    setFailure(null);
  }
  const close = () => {
    reset();
    onClose();
  };

  async function submit(event: FormEvent) {
    event.preventDefault();
    setFailure(null);
    const body = {
      displayName: name,
      ...(phone.trim() ? { phone } : {}),
      ...(email.trim() ? { email } : {}),
      role,
      classScope: role === 'teacher' ? [...scope] : [],
    };
    const parsed = inviteStaffSchema.safeParse(body);
    if (!parsed.success) {
      const next: Partial<Record<FieldName, string>> = {};
      for (const issue of parsed.error.issues) {
        const field = issue.path[0];
        if (field === 'displayName') next.displayName ??= t('errors.name');
        else if (field === 'phone') {
          next.phone ??=
            needsTwoStep([role]) && !phone.trim() ? t('errors.phoneRequired') : t('errors.phone');
        } else if (field === 'email') next.email ??= t('errors.email');
      }
      setIssues(next);
      return;
    }
    setIssues({});
    setBusy(true);
    try {
      await createBrowserApi().api.call('inviteStaff', body);
      toast({ tone: 'success', title: t('sent', { name }) });
      reset();
      onClose();
      router.refresh();
    } catch (err) {
      const code = actionError(err);
      if (code === 'conflict') setIssues({ phone: t('errors.taken') });
      else setFailure(code);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onClose={close} busy={busy} title={t('title')} description={t('body')}>
      <form noValidate onSubmit={(e) => void submit(e)} className="flex flex-col gap-4">
        <Field label={t('fields.name')} error={issues.displayName}>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={120}
            autoComplete="off"
          />
        </Field>
        <Field label={t('fields.role')} hint={t(`roleHint.${role}`)}>
          <Select value={role} onChange={(e) => setRole(e.target.value as StaffRole)}>
            {STAFF_ROLES.map((r) => (
              <option key={r} value={r}>
                {tRoles(r)}
              </option>
            ))}
          </Select>
        </Field>
        <Field
          label={t('fields.phone')}
          optional={needsTwoStep([role]) ? undefined : t('optional')}
          hint={needsTwoStep([role]) ? t('phoneHint') : undefined}
          error={issues.phone}
        >
          <PhoneInput value={phone} onChange={(e) => setPhone(e.target.value)} autoComplete="off" />
        </Field>
        <Field label={t('fields.email')} optional={t('optional')} error={issues.email}>
          <Input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            maxLength={254}
            autoComplete="off"
          />
        </Field>
        {role === 'teacher' ? (
          <ClassPicker classes={classes} value={scope} onChange={setScope} />
        ) : null}
        {failure ? <FormAlert>{tErrors(failure)}</FormAlert> : null}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="secondary" disabled={busy} onClick={close}>
            {t('cancel')}
          </Button>
          <Button type="submit" loading={busy}>
            {busy ? t('sending') : t('send')}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

/** Teacher's classes (STF-02); nothing ticked = only the classes they are assigned to. */
export function ClassPicker({
  classes,
  value,
  onChange,
}: {
  classes: readonly ClassOption[];
  value: readonly string[];
  onChange: (next: readonly string[]) => void;
}) {
  const t = useTranslations('staff.scope');
  return (
    <fieldset className="border-line m-0 flex flex-col rounded-md border px-3 py-2">
      <legend className="px-1 text-sm font-medium">{t('legend')}</legend>
      <p className="text-muted m-0 text-[13px]">{t('hint')}</p>
      {classes.length === 0 ? (
        <p className="text-muted m-0 py-2 text-sm">{t('none')}</p>
      ) : (
        classes.map((c) => (
          <Checkbox
            key={c.id}
            label={c.name}
            checked={value.includes(c.id)}
            onChange={(e) =>
              onChange(e.target.checked ? [...value, c.id] : value.filter((id) => id !== c.id))
            }
          />
        ))
      )}
    </fieldset>
  );
}
