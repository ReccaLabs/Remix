'use client';

import { Button, ConfirmDialog, useToast } from '@remix/ui';
import { Archive } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { createBrowserApi } from '@/lib/browser-api';
import { ADMIN_PATHS } from '@/lib/paths';
import { actionError } from '@/lib/people';

/** Archive one class from its header (CLS-02). History stays; the class leaves lists and the timetable. */
export function ClassArchive({ classId, name }: { classId: string; name: string }) {
  const t = useTranslations('classes.detail.archive');
  const tErrors = useTranslations('classes.errors');
  const router = useRouter();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  async function confirm() {
    setBusy(true);
    try {
      await createBrowserApi().api.call('archiveClass', { params: { id: classId } });
      toast({ tone: 'success', title: t('done', { name }) });
      setOpen(false);
      router.push(ADMIN_PATHS.classes);
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
        <Archive aria-hidden size={16} />
        {t('button')}
      </Button>
      <ConfirmDialog
        open={open}
        variant="destructive"
        title={t('title', { name })}
        description={t('body')}
        confirmLabel={t('confirm')}
        cancelLabel={t('cancel')}
        confirming={busy}
        onCancel={() => setOpen(false)}
        onConfirm={() => void confirm()}
      />
    </>
  );
}
