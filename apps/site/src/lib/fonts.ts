import {
  Bricolage_Grotesque,
  Geist,
  Geist_Mono,
  Noto_Sans_Sinhala,
  Noto_Sans_Tamil,
} from 'next/font/google';

// next/font self-hosts these at build time — no request to Google from the visitor's browser,
// which keeps the CSP simple (font-src 'self') and avoids a third-party privacy leak.

export const bricolage = Bricolage_Grotesque({
  subsets: ['latin'],
  weight: ['600', '700', '800'],
  variable: '--font-bricolage',
  display: 'swap',
});

export const geist = Geist({
  subsets: ['latin'],
  variable: '--font-geist',
  display: 'swap',
});

export const geistMono = Geist_Mono({
  subsets: ['latin'],
  weight: ['400', '500'],
  variable: '--font-geist-mono',
  display: 'swap',
});

// Script fonts are only needed for the language switcher labels today; `preload: false`
// keeps them off the critical path until Sinhala/Tamil pages go live.
export const notoSinhala = Noto_Sans_Sinhala({
  subsets: ['sinhala'],
  weight: ['400', '600'],
  variable: '--font-noto-sinhala',
  display: 'swap',
  preload: false,
});

export const notoTamil = Noto_Sans_Tamil({
  subsets: ['tamil'],
  weight: ['400', '600'],
  variable: '--font-noto-tamil',
  display: 'swap',
  preload: false,
});

export const fontVariables = [
  bricolage.variable,
  geist.variable,
  geistMono.variable,
  notoSinhala.variable,
  notoTamil.variable,
].join(' ');
