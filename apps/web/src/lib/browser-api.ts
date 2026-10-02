import { createApiClient, type ApiClient } from '@remix/types/api';

/**
 * Same-origin API client for client islands (ADR 0003/0006): `/api/v1` on this host, the
 * browser attaches the session cookie and CSRF headers itself. `retryAfter()` exposes the last
 * response's `Retry-After`, which `ApiError` does not carry, for "try again in N" messages.
 */
export function createBrowserApi(doFetch: typeof fetch = (input, init) => fetch(input, init)): {
  api: ApiClient;
  retryAfter: () => string | null;
} {
  let retryAfter: string | null = null;
  const api = createApiClient({
    baseUrl: '',
    fetch: async (input, init) => {
      retryAfter = null;
      const res = await doFetch(input, init);
      retryAfter = res.headers.get('retry-after');
      return res;
    },
  });
  return { api, retryAfter: () => retryAfter };
}
