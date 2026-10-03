import {
  API,
  type ApiInput,
  type ApiName,
  type ApiOptions,
  type ApiOutput,
  type EndpointDef,
} from './routes';
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
  /**
   * Extra headers per call. On the web server, only the ADR 0006 allow-list: `cookie`,
   * `x-forwarded-host`, `x-forwarded-proto`, `x-forwarded-for`, `x-request-id`.
   */
  headers?: () => HeadersInit | Promise<HeadersInit>;
  signal?: AbortSignal;
}

type BodyArg<N extends ApiName> = ApiInput<N> extends undefined ? [] : [body: ApiInput<N>];

/** Path params are required when the path has `:name` segments; query alone is optional. */
type OptionsArg<N extends ApiName> = (typeof API)[N] extends { params: unknown }
  ? [options: ApiOptions<N>]
  : (typeof API)[N] extends { query: unknown }
    ? [options?: ApiOptions<N>]
    : [];

type CallArgs<N extends ApiName> = [...BodyArg<N>, ...OptionsArg<N>];

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
      const def: EndpointDef = API[name];
      const callOptions = (def.request ? args[1] : args[0]) as CallOptions | undefined;
      const url = buildUrl(def, callOptions);
      const headers = new Headers(await options.headers?.());
      headers.set('accept', 'application/json');

      // Every state-changing call is JSON — even bodyless ones send `{}` — so the API can reject
      // any non-JSON unsafe request as a CSRF attempt (ADR 0003).
      let body: string | undefined;
      if (def.request) body = JSON.stringify(def.request.parse(args[0]));
      else if (def.method !== 'GET') body = '{}';
      if (body !== undefined) headers.set('content-type', 'application/json');

      const res = await doFetch(`${baseUrl}${url}`, {
        method: def.method,
        headers,
        body,
        credentials: 'same-origin',
        cache: 'no-store',
        signal: options.signal,
      });

      if (!res.ok) throw new ApiError(await readProblem(res));
      if (!def.response) return undefined as ApiOutput<typeof name>;
      return def.response.parse(await res.json()) as ApiOutput<typeof name>;
    },
  };
}

interface CallOptions {
  params?: unknown;
  query?: unknown;
}

/**
 * Fills `:name` path segments from the validated params (URI-encoded) and appends the validated
 * query. Query values are serialised as strings, so query schemas coerce on the server side.
 */
export function buildUrl(def: EndpointDef, options: CallOptions | undefined): string {
  let path: string = def.path;
  if (def.params) {
    const params = def.params.parse(options?.params) as Record<string, string | number>;
    path = path.replace(/:([A-Za-z]+)/g, (_, key: string) => {
      const value = params[key];
      if (value === undefined) throw new Error(`Missing path param "${key}" for ${def.path}`);
      return encodeURIComponent(String(value));
    });
  }
  if (def.query && options?.query !== undefined) {
    const query = def.query.parse(options.query) as Record<string, unknown>;
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === null) continue;
      for (const item of Array.isArray(value) ? value : [value]) search.append(key, String(item));
    }
    const qs = search.toString();
    if (qs) path += `?${qs}`;
  }
  return path;
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
