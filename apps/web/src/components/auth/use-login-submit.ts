'use client';

import { ApiError, type ApiClient } from '@remix/types/api';
import { useCallback, useState } from 'react';
import { createBrowserApi } from '@/lib/browser-api';
import { loginErrorFor, parseRetryAfter, type LoginError } from '@/lib/login-errors';
import { hardNavigate } from '@/lib/navigate';

/**
 * Shared submit logic of the login forms and their follow-up steps: call the API from the browser
 * (so its `Set-Cookie` lands here, ADR 0006), then load `redirectTo` in full; on failure keep the
 * form and show one mapped message. `onProblem` may take over an API error that starts a
 * follow-up step (DEVICE_LIMIT, TWO_STEP_REQUIRED) by returning true.
 */
export function useLoginSubmit(redirectTo: string) {
  const [error, setError] = useState<LoginError | null>(null);
  // Stays true after success so the button doesn't flash back while the next page loads.
  const [navigating, setNavigating] = useState(false);

  const submit = useCallback(
    async (
      send: (api: ApiClient) => Promise<unknown>,
      onProblem?: (err: ApiError) => boolean,
    ) => {
      setError(null);
      const { api, retryAfter } = createBrowserApi();
      try {
        await send(api);
      } catch (err) {
        if (err instanceof ApiError && onProblem?.(err)) return;
        setError(loginErrorFor(err, parseRetryAfter(retryAfter())));
        return;
      }
      setNavigating(true);
      hardNavigate(redirectTo);
    },
    [redirectTo],
  );

  return { error, setError, navigating, submit };
}
