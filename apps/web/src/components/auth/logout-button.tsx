'use client';

import { Button, cn } from '@remix/ui';
import { ApiError, createApiClient } from '@remix/types/api';
import { LogOut } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { hardNavigate } from '@/lib/navigate';

/**
 * Logs out from the browser (POST /api/v1/auth/logout, JSON `{}`), so the API's cookie-clearing
 * `Set-Cookie` reaches it, then loads the login page in full. Any API answer counts as logged
 * out (logout is always 204; a 401 means the session was already gone). Only a network failure
 * keeps the person here, with a message.
 */
export function LogoutButton({
  redirectTo,
  className,
  block = false,
}: {
  redirectTo: string;
  className?: string;
  block?: boolean;
}) {
  const t = useTranslations('common.session');
  const [state, setState] = useState<'idle' | 'pending' | 'failed'>('idle');

  async function logout() {
    setState('pending');
    try {
      await createApiClient({ baseUrl: '' }).call('logout');
    } catch (err) {
      if (!(err instanceof ApiError)) {
        setState('failed');
        return;
      }
    }
    hardNavigate(redirectTo);
  }

  return (
    <div className={cn('flex flex-col items-end gap-1', block && 'items-stretch', className)}>
      <Button
        variant="secondary"
        size="sm"
        block={block}
        loading={state === 'pending'}
        onClick={logout}
      >
        {state === 'pending' ? null : <LogOut aria-hidden size={16} />}
        {state === 'pending' ? t('loggingOut') : t('logout')}
      </Button>
      {state === 'failed' ? (
        <p role="alert" className="text-danger-ink m-0 max-w-64 text-right text-xs">
          {t('logoutFailed')}
        </p>
      ) : null}
    </div>
  );
}
