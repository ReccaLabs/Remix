import { BadRequestException, HttpException, NotFoundException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ERROR_CODES, problemSchema } from '@remix/types/api';
import { AppException, defaultTitle } from './app-exception';
import { codeForStatus, problemType, toProblem, zodFieldErrors } from './problem';

describe('AppException', () => {
  it('carries code, status, title, detail, field errors and headers', () => {
    const e = new AppException('DEVICE_LIMIT', 409, 'Signed in on 2 devices', {
      detail: 'Sign out of one to continue.',
      headers: { 'x-a': '1' },
    });
    expect(e).toMatchObject({ code: 'DEVICE_LIMIT', status: 409, title: 'Signed in on 2 devices' });
    expect(e.detail).toBe('Sign out of one to continue.');
    expect(e.headers).toEqual({ 'x-a': '1' });
  });

  it('defaults the title from the status', () => {
    expect(new AppException('NOT_FOUND', 404).title).toBe('Not found');
  });

  it.each([200, 399, 600, 404.5])('refuses non-error status %s', (status) => {
    expect(() => new AppException('INTERNAL', status)).toThrow(RangeError);
  });
});

describe('toProblem', () => {
  const valid = (p: unknown) => problemSchema.strict().parse(p);

  it('renders an AppException verbatim', () => {
    const { problem, unexpected } = toProblem(
      new AppException('INVALID_CREDENTIALS', 401, 'Phone number or password is incorrect'),
      'req-1',
    );
    expect(valid(problem)).toEqual({
      type: 'https://remix.lk/problems/invalid-credentials',
      title: 'Phone number or password is incorrect',
      status: 401,
      code: 'INVALID_CREDENTIALS',
      requestId: 'req-1',
    });
    expect(unexpected).toBe(false);
  });

  it('passes AppException headers through (Retry-After)', () => {
    const r = toProblem(
      new AppException('RATE_LIMITED', 429, undefined, { headers: { 'retry-after': '5' } }),
      'r',
    );
    expect(r.headers).toEqual({ 'retry-after': '5' });
  });

  it('carries a challenge member only when the exception has one', () => {
    const challenge = { token: 't'.repeat(43), devices: [], expiresAt: '2026-10-15T04:35:00Z' };
    const withChallenge = toProblem(
      new AppException('DEVICE_LIMIT', 403, 'Too many devices', { challenge }),
      'r',
    );
    expect(withChallenge.problem.challenge).toEqual(challenge);
    expect('challenge' in toProblem(new AppException('FORBIDDEN', 403), 'r').problem).toBe(false);
  });

  it('maps a ZodError to 400 with dot paths', () => {
    const schema = z.strictObject({ phone: z.string(), address: z.object({ city: z.string() }) });
    const error = schema.safeParse({ phone: 1, address: { city: 2 }, extra: true }).error;
    const { problem } = toProblem(error, 'r');
    expect(valid(problem).code).toBe('VALIDATION_FAILED');
    expect(problem.status).toBe(400);
    expect(problem.errors?.map((e) => e.path).sort()).toEqual(['address.city', 'extra', 'phone']);
  });

  it('uses only the status of a Nest HttpException, never its message', () => {
    const { problem } = toProblem(new BadRequestException('column "secret" does not exist'), 'r');
    expect(problem).toMatchObject({ status: 400, code: 'VALIDATION_FAILED', title: 'Bad request' });
    expect(JSON.stringify(problem)).not.toContain('secret');
    expect(toProblem(new NotFoundException('Cannot GET /x'), 'r').problem.title).toBe('Not found');
  });

  it('flags 5xx HttpExceptions as unexpected', () => {
    expect(toProblem(new HttpException('x', 503), 'r')).toMatchObject({
      unexpected: true,
      problem: { status: 503, code: 'INTERNAL' },
    });
  });

  it.each([
    ['entity.too.large', 413, 413],
    ['entity.parse.failed', 400, 400],
    ['charset.unsupported', 415, 415],
    ['encoding.unsupported', 415, 415],
    ['request.aborted', 400, 400],
  ])('maps body-parser %s to %i', (type, status, expected) => {
    const err = Object.assign(new Error('raw parser message with body {"pw":1}'), { type, status });
    const { problem, unexpected } = toProblem(err, 'r');
    expect(problem.status).toBe(expected);
    expect(problem.code).toBe('VALIDATION_FAILED');
    expect(JSON.stringify(problem)).not.toContain('pw');
    expect(unexpected).toBe(false);
  });

  it.each([
    new Error('ECONNREFUSED 10.0.0.3:5432'),
    'a string',
    null,
    { status: 400 },
    { type: 'x', status: 500 },
  ])('turns anything else into a generic 500 (%s)', (thrown) => {
    const { problem, unexpected } = toProblem(thrown, 'r');
    expect(valid(problem)).toMatchObject({
      status: 500,
      code: 'INTERNAL',
      title: 'Something went wrong',
    });
    expect(unexpected).toBe(true);
  });

  it('omits requestId when there is none', () => {
    expect(toProblem(new Error('x'), undefined).problem).not.toHaveProperty('requestId');
  });
});

describe('zodFieldErrors', () => {
  it('reports root-level issues with an empty path', () => {
    const error = z.string().safeParse(1).error!;
    expect(zodFieldErrors(error)).toEqual([{ path: '', message: expect.any(String) }]);
  });
});

describe('codeForStatus / problemType / defaultTitle', () => {
  it.each([
    [400, 'VALIDATION_FAILED'],
    [401, 'UNAUTHENTICATED'],
    [403, 'FORBIDDEN'],
    [404, 'NOT_FOUND'],
    [405, 'NOT_FOUND'],
    [409, 'CONFLICT'],
    [413, 'VALIDATION_FAILED'],
    [422, 'VALIDATION_FAILED'],
    [429, 'RATE_LIMITED'],
    [500, 'INTERNAL'],
    [502, 'INTERNAL'],
  ])('%i → %s', (status, code) => {
    expect(codeForStatus(status)).toBe(code);
  });

  it('builds a kebab-case type URI for every code', () => {
    for (const code of ERROR_CODES)
      expect(problemType(code)).toMatch(/^https:\/\/remix\.lk\/problems\/[a-z-]+$/);
  });

  it('has generic titles for unknown statuses', () => {
    expect(defaultTitle(418)).toBe('Request failed');
    expect(defaultTitle(599)).toBe('Something went wrong');
  });
});
