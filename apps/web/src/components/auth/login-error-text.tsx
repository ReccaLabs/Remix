'use client';

import { useTranslations } from 'next-intl';
import type { LoginError } from '@/lib/login-errors';

/** The localised sentence for a failed login (`auth.errors.*`). */
export function LoginErrorText({ error, who }: { error: LoginError; who: 'student' | 'staff' }) {
  const t = useTranslations('auth.errors');
  switch (error.key) {
    case 'invalidCredentials':
      return t('invalidCredentials', { who });
    case 'rateLimitedSeconds':
      return t('rateLimitedSeconds', error.values);
    case 'rateLimitedMinutes':
      return t('rateLimitedMinutes', error.values);
    default:
      return t(error.key);
  }
}
