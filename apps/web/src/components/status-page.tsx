import type { ReactNode } from 'react';

/**
 * Centered, neutral message page: 404, error, "temporarily unavailable". No hooks and no server
 * APIs, so both server pages and client error boundaries can render it.
 */
export function StatusPage({
  title,
  body,
  children,
}: {
  title: string;
  body: string;
  /** Actions and footnotes under the text. */
  children?: ReactNode;
}) {
  return (
    <main
      id="main"
      className="flex min-h-dvh flex-col items-center justify-center gap-5 px-4 py-16 text-center"
    >
      <h1 className="font-display m-0 text-balance text-3xl font-bold tracking-tight sm:text-4xl">
        {title}
      </h1>
      <p className="text-muted m-0 max-w-md text-pretty">{body}</p>
      {children}
    </main>
  );
}
