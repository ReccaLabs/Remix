import { buttonClass, Logo } from '@remix/ui';
import Link from 'next/link';
import { fontVariables } from '@/lib/fonts';

// Global 404 (exported as out/404.html, served by Cloudflare Pages for unknown paths).
// Outside the [locale] tree, so it has its own <html> and plain English text.
export default function NotFound() {
  return (
    <html lang="en" className={fontVariables}>
      <body>
        <main className="flex min-h-dvh flex-col items-center justify-center gap-6 px-4 text-center">
          <Link href="/en/" aria-label="ReMix home">
            <Logo size={32} label="" />
          </Link>
          <h1 className="font-display m-0 text-4xl font-bold tracking-tight">Page not found</h1>
          <p className="text-muted m-0 max-w-md">
            The page you&apos;re looking for doesn&apos;t exist or has moved.
          </p>
          <Link href="/en/" className={buttonClass()}>
            Go to the home page
          </Link>
        </main>
      </body>
    </html>
  );
}
