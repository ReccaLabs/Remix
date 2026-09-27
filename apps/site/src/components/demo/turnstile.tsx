'use client';

import { useEffect, useRef } from 'react';

/**
 * Cloudflare Turnstile, rendered explicitly. The script is only requested on pages that show
 * this widget (CSP already allows challenges.cloudflare.com for script-src and frame-src).
 * The token is verified server-side in functions/api/lead.ts — the widget alone proves nothing.
 */

type TurnstileOptions = {
  sitekey: string;
  action: string;
  theme: 'light' | 'dark' | 'auto';
  size: 'normal' | 'flexible' | 'compact';
  language: string;
  'response-field': boolean;
  callback: (token: string) => void;
  'expired-callback': () => void;
  'error-callback': () => boolean;
};

type TurnstileApi = {
  render: (el: HTMLElement, options: TurnstileOptions) => string;
  reset: (widgetId: string) => void;
  remove: (widgetId: string) => void;
};

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

const SCRIPT_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
/** Must match TURNSTILE_ACTION in functions/api/lead.ts. */
export const TURNSTILE_ACTION = 'lead';

let loading: Promise<TurnstileApi> | null = null;

function loadTurnstile(): Promise<TurnstileApi> {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  loading ??= new Promise<TurnstileApi>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = SCRIPT_SRC;
    script.async = true;
    script.onload = () =>
      window.turnstile ? resolve(window.turnstile) : reject(new Error('turnstile_missing'));
    script.onerror = () => {
      loading = null;
      script.remove();
      reject(new Error('turnstile_load_failed'));
    };
    document.head.appendChild(script);
  });
  return loading;
}

export function Turnstile({
  siteKey,
  language,
  resetKey,
  onToken,
  onUnavailable,
}: {
  siteKey: string;
  language: string;
  /** Change this number to get a fresh token (tokens are single-use). */
  resetKey: number;
  onToken: (token: string | null) => void;
  onUnavailable: () => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const widgetId = useRef<string | null>(null);
  const handlers = useRef({ onToken, onUnavailable });

  useEffect(() => {
    handlers.current = { onToken, onUnavailable };
  });

  useEffect(() => {
    let cancelled = false;
    loadTurnstile()
      .then((api) => {
        if (cancelled || !container.current) return;
        widgetId.current = api.render(container.current, {
          sitekey: siteKey,
          action: TURNSTILE_ACTION,
          theme: 'light',
          size: 'flexible',
          language,
          'response-field': false,
          callback: (token) => handlers.current.onToken(token),
          'expired-callback': () => handlers.current.onToken(null),
          'error-callback': () => {
            handlers.current.onToken(null);
            return false; // let Turnstile retry / show its own message
          },
        });
      })
      .catch(() => {
        if (!cancelled) handlers.current.onUnavailable();
      });

    return () => {
      cancelled = true;
      if (widgetId.current) window.turnstile?.remove(widgetId.current);
      widgetId.current = null;
    };
  }, [siteKey, language]);

  useEffect(() => {
    if (resetKey > 0 && widgetId.current) {
      handlers.current.onToken(null);
      window.turnstile?.reset(widgetId.current);
    }
  }, [resetKey]);

  // Reserve the widget's height so the form doesn't jump when it appears.
  return <div ref={container} className="min-h-[65px]" />;
}
