import type common from '../../messages/en/common.json';
import type errors from '../../messages/en/errors.json';
import type platform from '../../messages/en/platform.json';
import type tenant from '../../messages/en/tenant.json';
import type { Locale } from './config';

/** One file per namespace in messages/<locale>/. English is the reference for key types. */
export const NAMESPACES = ['common', 'errors', 'tenant', 'platform'] as const;

export type Namespace = (typeof NAMESPACES)[number];

export interface Messages {
  common: typeof common;
  errors: typeof errors;
  tenant: typeof tenant;
  platform: typeof platform;
}

declare module 'next-intl' {
  interface AppConfig {
    Locale: Locale;
    Messages: Messages;
  }
}
