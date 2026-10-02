const QUERY_ERROR_NAME = 'DrizzleQueryError';
const FIXED_MESSAGE = 'query failed';
const MAX_DEPTH = 4;
/** Properties that hold (or can hold) SQL, bound values or row data; never copied into a log. */
const SENSITIVE_KEYS = new Set(['query', 'params', 'parameters', 'detail', 'where']);
/** Properties already written explicitly. */
const HANDLED_KEYS = new Set(['name', 'message', 'stack', 'cause', 'raw']);

type Loggable = Record<string, unknown>;

const isErrorLike = (value: unknown): value is Error & Loggable =>
  typeof value === 'object' &&
  value !== null &&
  typeof (value as { message?: unknown }).message === 'string';

const typeOf = (err: Error): string =>
  typeof err.constructor === 'function' && err.constructor.name ? err.constructor.name : err.name;

/**
 * drizzle-orm's `DrizzleQueryError` puts the SQL *and the bound parameters* in `message` (and so
 * in `stack`) and on `query` / `params`. Matched by class name, `name`, or the mere presence of
 * `params`, so a subclass or a wrapper that kept the shape is covered too.
 */
export function isQueryError(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false;
  const e = err as Loggable;
  return typeOf(err as Error) === QUERY_ERROR_NAME || e.name === QUERY_ERROR_NAME || 'params' in e;
}

/**
 * The stack minus its header. The header repeats `message`, which may hold SQL and bound params,
 * and a param can itself contain "\n    at …" — so the header is cut by its known length, not by
 * searching for the first frame-looking line. Only frame lines survive.
 */
function frames(err: Error): string {
  const stack: unknown = err.stack;
  if (typeof stack !== 'string') return '';
  const header = `${err.name}: ${err.message}`;
  if (!stack.startsWith(header)) return '';
  return stack
    .slice(header.length)
    .split('\n')
    .filter((l) => /^\s+at\s/.test(l))
    .join('\n');
}

/** Postgres echoes the offending literal in "invalid input syntax for type x: \"value\"". */
const scrubMessage = (message: string): string =>
  message.replace(/(invalid input (?:syntax|value) for [^:]+):.*$/s, '$1');

/** A cause of a query error: the Postgres error. `code` and `message` only — never `detail`. */
function serializeCause(cause: unknown, depth: number): unknown {
  if (!isErrorLike(cause)) return undefined;
  if (isQueryError(cause)) return serializeQueryError(cause, depth);
  const next = (cause as { cause?: unknown }).cause;
  const out: Loggable = { type: typeOf(cause) };
  if (typeof cause.code === 'string') out.code = cause.code;
  out.message = scrubMessage(cause.message);
  if (next !== undefined && depth < MAX_DEPTH) out.cause = serializeCause(next, depth + 1);
  return out;
}

function serializeQueryError(err: Error & Loggable, depth: number): Loggable {
  const out: Loggable = {
    type: QUERY_ERROR_NAME,
    message: FIXED_MESSAGE,
    stack: `${QUERY_ERROR_NAME}: ${FIXED_MESSAGE}\n${frames(err)}`.trimEnd(),
  };
  if (err.cause !== undefined && depth < MAX_DEPTH) {
    const cause = serializeCause(err.cause, depth + 1);
    if (cause !== undefined) out.cause = cause;
  }
  return out;
}

function serializeAny(err: unknown, depth: number, seen: Set<unknown>): unknown {
  if (!isErrorLike(err)) return err;
  if (isQueryError(err)) return serializeQueryError(err, depth);
  seen.add(err);

  const out: Loggable = { type: typeOf(err), message: err.message, stack: err.stack };
  for (const key of Object.keys(err)) {
    if (HANDLED_KEYS.has(key) || SENSITIVE_KEYS.has(key)) continue;
    const value = err[key];
    out[key] = isErrorLike(value) ? serializeAny(value, depth + 1, seen) : value;
  }
  const cause = (err as { cause?: unknown }).cause;
  if (cause !== undefined) {
    // A cause may be a query error wrapped by app code: it must go through the same scrubbing.
    out.cause =
      depth >= MAX_DEPTH || seen.has(cause) ? '[truncated]' : serializeAny(cause, depth + 1, seen);
  }
  return out;
}

/**
 * pino-http hands a custom `err` serializer the output of pino's standard one, whose `message`
 * and `stack` already have every cause's message and stack appended (SQL and params included)
 * and whose `query`/`params` are copied across. The original error is still reachable as the
 * non-enumerable `raw`; start from that.
 */
function original(err: unknown): unknown {
  if (typeof err === 'object' && err !== null && 'raw' in err) {
    const raw = (err as { raw?: unknown }).raw;
    if (isErrorLike(raw)) return raw;
  }
  return err;
}

/**
 * pino `err` serializer. Plain errors keep their message and stack; query errors (and any error
 * with `params`) are reduced to `type`, the Postgres `code`/`message` of the cause and a stack
 * whose header is replaced — so SQL text, bound parameters (phone numbers, password and token
 * hashes) and Postgres `detail` never reach the logs, however deep the error is wrapped.
 */
export function serializeError(err: unknown): unknown {
  return serializeAny(original(err), 0, new Set());
}
