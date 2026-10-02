/**
 * Request headers the proxy sets for server code. The proxy always overwrites (or deletes)
 * them, so a client can never inject its own values: server code trusts these and nothing
 * else about the host.
 */
export const REQUEST_HEADERS = {
  /** `tenant` | `platform` — absent on requests the proxy sent to the 404 page. */
  area: 'x-remix-area',
  /** The normalised request host (lower-case, no port) the proxy classified. */
  host: 'x-remix-host',
  /** Correlation id, also forwarded to the API and returned to the browser. */
  requestId: 'x-request-id',
  /** CSP nonce for the rare component that renders its own <script>/<style>. */
  nonce: 'x-nonce',
  /** Browser-facing path + query (before the area rewrite), for login `?next=` redirects. */
  path: 'x-remix-path',
} as const;

const REQUEST_ID = /^[A-Za-z0-9._:-]{8,128}$/;

/**
 * Reuse an upstream request id (edge proxy) when it is log-safe; otherwise mint one (ADR 0006).
 * The strict charset keeps a client-chosen value from injecting into log lines.
 */
export function resolveRequestId(incoming: string | null): string {
  return incoming && REQUEST_ID.test(incoming) ? incoming : crypto.randomUUID();
}
