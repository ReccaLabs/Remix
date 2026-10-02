import { expect } from 'vitest';
import type { Response } from 'supertest';
import { problemSchema, type ErrorCode, type Problem } from '@remix/types/api';

/**
 * Assert an RFC 9457 problem response: right status and code, `application/problem+json`,
 * exactly the contract's members (no extras), and the request id matching the header.
 */
export function expectProblem(res: Response, status: number, code: ErrorCode): Problem {
  expect(res.status).toBe(status);
  expect(res.headers['content-type']).toMatch(/^application\/problem\+json/);
  expect(res.headers['cache-control']).toBe('no-store');
  const problem = problemSchema.strict().parse(JSON.parse(res.text));
  expect(problem.code).toBe(code);
  expect(problem.status).toBe(status);
  expect(problem.type).toBe(`https://remix.lk/problems/${code.toLowerCase().replaceAll('_', '-')}`);
  expect(problem.requestId).toBe(res.headers['x-request-id']);
  return problem;
}
