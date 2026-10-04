import localFont from 'next/font/local';

// Official Fontsource variable assets and OFL licences live in packages/ui/fonts.
// Builds read these files locally; visitors load only same-origin font assets.

export const bricolage = localFont({
  src: '../../../../packages/ui/fonts/bricolage-grotesque/bricolage-grotesque-latin-wght-normal.woff2',
  weight: '600 800',
  variable: '--font-bricolage',
  display: 'swap',
});

export const geist = localFont({
  src: '../../../../packages/ui/fonts/geist/geist-latin-wght-normal.woff2',
  weight: '100 900',
  variable: '--font-geist',
  display: 'swap',
});

export const geistMono = localFont({
  src: '../../../../packages/ui/fonts/geist-mono/geist-mono-latin-wght-normal.woff2',
  weight: '400 500',
  variable: '--font-geist-mono',
  display: 'swap',
});

// Script fonts are only needed for the language switcher labels today; `preload: false`
// keeps them off the critical path until Sinhala/Tamil pages go live.
export const notoSinhala = localFont({
  src: [
    {
      path: '../../../../packages/ui/fonts/noto-sans-sinhala/noto-sans-sinhala-latin-wght-normal.woff2',
    },
    {
      path: '../../../../packages/ui/fonts/noto-sans-sinhala/noto-sans-sinhala-sinhala-wght-normal.woff2',
    },
  ],
  weight: '400 600',
  variable: '--font-noto-sinhala',
  display: 'swap',
  preload: false,
});

export const notoTamil = localFont({
  src: [
    {
      path: '../../../../packages/ui/fonts/noto-sans-tamil/noto-sans-tamil-latin-wght-normal.woff2',
    },
    {
      path: '../../../../packages/ui/fonts/noto-sans-tamil/noto-sans-tamil-tamil-wght-normal.woff2',
    },
  ],
  weight: '400 600',
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
