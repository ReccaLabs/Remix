'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import type { LoginError } from '@/lib/login-errors';
import { TENANT_PATHS } from '@/lib/paths';

/** The localised sentence for a failed login or code step (`auth.errors.*`). */
export function LoginErrorText({ error, who }: { error: LoginError; who: 'student' | 'staff' }) {
  const t = useTranslations('auth.errors');
  switch (error.key) {
    case 'invalidCredentials':
      return t('invalidCredentials', { who });
    case 'rateLimitedSeconds':
      return t('rateLimitedSeconds', error.values);
    case 'rateLimitedMinutes':
      return t('rateLimitedMinutes', error.values);
    case 'accountLocked':
      return t.rich('accountLocked', {
        link: (chunks) => (
          <Link
            href={who === 'staff' ? TENANT_PATHS.staffUnlock : TENANT_PATHS.studentUnlock}
            className="text-danger-ink font-semibold underline"
          >
            {chunks}
          </Link>
        ),
      });
    default:
      return t(error.key);
  }
}
