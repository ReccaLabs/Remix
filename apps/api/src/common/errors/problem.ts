import { HttpException } from '@nestjs/common';
import { ZodError } from 'zod';
import type { ErrorCode, Problem } from '@remix/types/api';
import { AppException, defaultTitle, type FieldError } from './app-exception';

/** Stable, dereferenceable problem type URI for a code: `INVALID_CREDENTIALS` → `…/invalid-credentials`. */
export function problemType(code: ErrorCode): string {
  return `https://remix.lk/problems/${code.toLowerCase().replaceAll('_', '-')}`;
}

export interface RenderedProblem {
  problem: Problem;
  headers: Record<string, string>;
  /** True when the error is ours (a bug or an outage) and must be logged with its stack. */
  unexpected: boolean;
}

/**
 * Map anything thrown while handling a request to an RFC 9457 problem. Only `AppException`
 * titles/details and Zod issue messages reach the client; every other error collapses to a
 * generic title for its status, so stack traces, SQL and internal messages never leak.
 */
export function toProblem(error: unknown, requestId: string | undefined): RenderedProblem {
  const base = (status: number, code: ErrorCode, title = defaultTitle(status)): Problem => ({
    type: problemType(code),
    title,
    status,
    code,
    ...(requestId ? { requestId } : {}),
  });

  if (error instanceof AppException) {
    const problem = base(error.status, error.code, error.title);
    if (error.detail) problem.detail = error.detail;
    if (error.errors?.length) problem.errors = error.errors;
    if (error.challenge !== undefined) problem.challenge = error.challenge;
    return { problem, headers: error.headers, unexpected: error.status >= 500 };
  }

  if (error instanceof ZodError) {
    const problem = base(400, 'VALIDATION_FAILED', 'Some fields are invalid');
    problem.errors = zodFieldErrors(error);
    return { problem, headers: {}, unexpected: false };
  }

  if (error instanceof HttpException) {
    const status = error.getStatus();
    return { problem: base(status, codeForStatus(status)), headers: {}, unexpected: status >= 500 };
  }

  const bodyError = bodyParserProblem(error);
  if (bodyError)
    return {
      problem: base(bodyError.status, 'VALIDATION_FAILED', bodyError.title),
      headers: {},
      unexpected: false,
    };

  return { problem: base(500, 'INTERNAL'), headers: {}, unexpected: true };
}

/** Field errors with dot-joined paths. Unknown keys are reported one per key at their own path. */
export function zodFieldErrors(error: ZodError): FieldError[] {
  return error.issues.flatMap((issue) => {
    const path = issue.path.map(String);
    if (issue.code === 'unrecognized_keys') {
      return issue.keys.map((key) => ({
        path: [...path, key].join('.'),
        message: 'Unknown field',
      }));
    }
    return [{ path: path.join('.'), message: issue.message }];
  });
}

export function codeForStatus(status: number): ErrorCode {
  switch (status) {
    case 401:
      return 'UNAUTHENTICATED';
    case 403:
      return 'FORBIDDEN';
    case 404:
    case 405:
      return 'NOT_FOUND';
    case 409:
      return 'CONFLICT';
    case 429:
      return 'RATE_LIMITED';
    default:
      return status >= 500 ? 'INTERNAL' : 'VALIDATION_FAILED';
  }
}

/** Errors from Express' body parser carry a `type` and a 4xx `status`. */
function bodyParserProblem(error: unknown): { status: number; title: string } | null {
  if (typeof error !== 'object' || error === null || !('type' in error) || !('status' in error)) {
    return null;
  }
  const { type, status } = error;
  if (typeof type !== 'string' || typeof status !== 'number' || status < 400 || status > 499) {
    return null;
  }
  switch (type) {
    case 'entity.too.large':
      return { status: 413, title: defaultTitle(413) };
    case 'entity.parse.failed':
      return { status: 400, title: 'Request body is not valid JSON' };
    case 'charset.unsupported':
    case 'encoding.unsupported':
      return { status: 415, title: defaultTitle(415) };
    default:
      return { status, title: defaultTitle(status) };
  }
}
