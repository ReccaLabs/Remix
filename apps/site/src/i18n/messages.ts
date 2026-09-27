import type about from '../../messages/en/about.json';
import type common from '../../messages/en/common.json';
import type demo from '../../messages/en/demo.json';
import type guides from '../../messages/en/guides.json';
import type home from '../../messages/en/home.json';
import type institutes from '../../messages/en/institutes.json';
import type legal from '../../messages/en/legal.json';
import type pricing from '../../messages/en/pricing.json';
import type teachers from '../../messages/en/teachers.json';
import type { routing } from './routing';

/** One file per namespace in messages/<locale>/. English is the reference for key types. */
export const NAMESPACES = [
  'common',
  'home',
  'pricing',
  'institutes',
  'teachers',
  'guides',
  'about',
  'demo',
  'legal',
] as const;

export type Namespace = (typeof NAMESPACES)[number];

export interface Messages {
  common: typeof common;
  home: typeof home;
  pricing: typeof pricing;
  institutes: typeof institutes;
  teachers: typeof teachers;
  guides: typeof guides;
  about: typeof about;
  demo: typeof demo;
  legal: typeof legal;
}

declare module 'next-intl' {
  interface AppConfig {
    Locale: (typeof routing.locales)[number];
    Messages: Messages;
  }
}
