import type { ErrorCode, Problem } from '@remix/types/api';

export type FieldError = NonNullable<Problem['errors']>[number];

export interface AppExceptionOptions {
  /** Human-readable explanation specific to this occurrence. Shown to users — no internals. */
  detail?: string;
  errors?: FieldError[];
  /** Extra response headers (e.g. `Retry-After`). */
  headers?: Record<string, string>;
  /**
   * Follow-up step for `DEVICE_LIMIT` / `TWO_STEP_REQUIRED` (the problem's `challenge` member).
   * Must already match its contract schema (`deviceLimitChallengeSchema`, `twoStepChallengeSchema`).
   */
  challenge?: unknown;
}

/**
 * The error business code throws. Rendered as `application/problem+json` by the global filter:
 * `code` is the stable thing clients branch on; `title` is a short, safe summary.
 *
 * ```ts
 * throw new AppException('DEVICE_LIMIT', 409, 'You are signed in on 2 devices');
 * ```
 */
export class AppException extends Error {
  readonly detail: string | undefined;
  readonly errors: FieldError[] | undefined;
  readonly headers: Record<string, string>;
  readonly challenge: unknown;

  constructor(
    readonly code: ErrorCode,
    readonly status: number,
    readonly title: string = defaultTitle(status),
    options: AppExceptionOptions = {},
  ) {
    super(`${status} ${code}: ${title}`);
    this.name = 'AppException';
    if (!Number.isInteger(status) || status < 400 || status > 599) {
      throw new RangeError(`AppException status must be 400–599, got ${status}`);
    }
    this.detail = options.detail;
    this.errors = options.errors;
    this.headers = options.headers ?? {};
    this.challenge = options.challenge;
  }
}

const TITLES: Record<number, string> = {
  400: 'Bad request',
  401: 'Sign in required',
  403: 'Not allowed',
  404: 'Not found',
  405: 'Method not allowed',
  409: 'Conflict',
  413: 'Request body is too large',
  415: 'Unsupported media type',
  422: 'Unprocessable request',
  429: 'Too many requests',
  500: 'Something went wrong',
  503: 'Service unavailable',
};

/** Generic, safe title for a status code. */
export function defaultTitle(status: number): string {
  return TITLES[status] ?? (status >= 500 ? 'Something went wrong' : 'Request failed');
}
