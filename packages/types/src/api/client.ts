import { API, type ApiInput, type ApiName, type ApiOutput } from './routes';
import { problemSchema, type Problem } from './problem';

/** A non-2xx API response. `problem.code` is the stable thing to branch on. */
export class ApiError extends Error {
  readonly problem: Problem;

  constructor(problem: Problem) {
    super(`${problem.status} ${problem.code}: ${problem.title}`);
    this.name = 'ApiError';
    this.problem = problem;
  }

  get status(): number {
    return this.problem.status;
  }
}

export interface ApiClientOptions {
  /**
   * Origin to call. Empty string in the browser (same-origin `/api/v1`, ADR 0003).
   * On the web server: the internal API URL, with the tenant host forwarded in `headers`.
   */
  baseUrl?: string;
  fetch?: typeof fetch;
  /** Extra headers per call — on the server: `cookie` and `x-forwarded-host`. */
  headers?: () => HeadersInit | Promise<HeadersInit>;
  signal?: AbortSignal;
}

type CallArgs<N extends ApiName> = ApiInput<N> extends undefined ? [] : [body: ApiInput<N>];

export interface ApiClient {
  call<N extends ApiName>(name: N, ...args: CallArgs<N>): Promise<ApiOutput<N>>;
}

/**
 * Typed client for the ReMix API. Request bodies are validated before sending (so a bad form
 * value fails fast with the same messages as the server) and responses are validated on
 * arrival (so a contract drift surfaces as an error, not as `undefined` deep in a component).
 */
export function createApiClient(options: ApiClientOptions = {}): ApiClient {
  const doFetch = options.fetch ?? fetch;
  const baseUrl = options.baseUrl ?? '';

  return {
    async call(name, ...args) {
      const def = API[name];
      const headers = new Headers(await options.headers?.());
      headers.set('accept', 'application/json');

      let body: string | undefined;
      if ('request' in def) {
        body = JSON.stringify(def.request.parse(args[0]));
        headers.set('content-type', 'application/json');
      }

      const res = await doFetch(`${baseUrl}${def.path}`, {
        method: def.method,
        headers,
        body,
        credentials: 'same-origin',
        cache: 'no-store',
        signal: options.signal,
      });

      if (!res.ok) throw new ApiError(await readProblem(res));
      if (!('response' in def)) return undefined as ApiOutput<typeof name>;
      return def.response.parse(await res.json()) as ApiOutput<typeof name>;
    },
  };
}

async function readProblem(res: Response): Promise<Problem> {
  try {
    const parsed = problemSchema.safeParse(await res.json());
    if (parsed.success) return parsed.data;
  } catch {
    // Not JSON (proxy error page, network middlebox) — fall through to a generic problem.
  }
  return {
    type: 'about:blank',
    title: res.statusText || 'Request failed',
    status: res.status >= 400 && res.status <= 599 ? res.status : 500,
    code: res.status === 401 ? 'UNAUTHENTICATED' : res.status === 404 ? 'NOT_FOUND' : 'INTERNAL',
  };
}
