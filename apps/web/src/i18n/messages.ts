import type admin from '../../messages/en/admin.json';
import type auth from '../../messages/en/auth.json';
import type common from '../../messages/en/common.json';
import type errors from '../../messages/en/errors.json';
import type platform from '../../messages/en/platform.json';
import type portal from '../../messages/en/portal.json';
import type staff from '../../messages/en/staff.json';
import type students from '../../messages/en/students.json';
import type tenant from '../../messages/en/tenant.json';
import type { Locale } from './config';

/** One file per namespace in messages/<locale>/. English is the reference for key types. */
export const NAMESPACES = [
  'common',
  'errors',
  'tenant',
  'auth',
  'portal',
  'admin',
  'platform',
  'students',
  'staff',
] as const;

export type Namespace = (typeof NAMESPACES)[number];

export interface Messages {
  common: typeof common;
  errors: typeof errors;
  tenant: typeof tenant;
  auth: typeof auth;
  portal: typeof portal;
  admin: typeof admin;
  platform: typeof platform;
  students: typeof students;
  staff: typeof staff;
}

declare module 'next-intl' {
  interface AppConfig {
    Locale: Locale;
    Messages: Messages;
  }
}
