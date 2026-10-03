'use client';

import { Button, ConfirmDialog, useToast } from '@remix/ui';
import { Archive, RotateCcw } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { createBrowserApi } from '@/lib/browser-api';
import { actionError } from '@/lib/people';

/** Archive / reactivate one student from the profile header (STU-07). */
export function StudentLifecycle({
  studentId,
  name,
  archived,
}: {
  studentId: string;
  name: string;
  archived: boolean;
}) {
  const t = useTranslations('students.profile.lifecycle');
  const tErrors = useTranslations('students.errors');
  const router = useRouter();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const key = archived ? 'reactivate' : 'archive';

  async function confirm() {
    setBusy(true);
    try {
      await createBrowserApi().api.call('bulkStudents', {
        action: key,
        studentIds: [studentId],
      });
      toast({ tone: 'success', title: t(`${key}.done`, { name }) });
      setOpen(false);
      router.refresh();
    } catch (err) {
      toast({ tone: 'danger', title: tErrors(actionError(err)) });
      setOpen(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)}>
        {archived ? <RotateCcw aria-hidden size={16} /> : <Archive aria-hidden size={16} />}
        {t(`${key}.button`)}
      </Button>
      <ConfirmDialog
        open={open}
        variant={archived ? 'default' : 'destructive'}
        title={t(`${key}.title`, { name })}
        description={t(`${key}.body`)}
        confirmLabel={t(`${key}.confirm`)}
        cancelLabel={t('cancel')}
        confirming={busy}
        onCancel={() => setOpen(false)}
        onConfirm={() => void confirm()}
      />
    </>
  );
}
