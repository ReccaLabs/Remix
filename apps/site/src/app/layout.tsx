import type { ReactNode } from 'react';
import './globals.css';

// The real <html>/<body> live in app/[locale]/layout.tsx so `lang` is correct per locale.
// This root layout only exists so the root redirect page and 404 have a parent.
export default function RootLayout({ children }: { children: ReactNode }) {
  return children;
}
