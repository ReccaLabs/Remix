import { Writable } from 'node:stream';
import { DrizzleQueryError } from 'drizzle-orm';
import pino, { stdSerializers } from 'pino';
import { describe, expect, it } from 'vitest';
import { serializeError } from './error-serializer';
import { REDACT_PATHS } from './logger';

const PHONE = '+94771234567';
const HASH = '$argon2id$v=19$m=19456,t=2,p=1$c29tZXNhbHQ$aGFzaGhhc2hoYXNoaGFzaA';
const TOKEN_HASH = 'a3f1c0de'.repeat(8);

/** What `pg` throws for a unique violation: `detail` echoes the offending row's values. */
function pgError(): Error & { code: string; detail: string } {
  return Object.assign(
    new Error('duplicate key value violates unique constraint "tenant_users_phone_key"'),
    { name: 'error', code: '23505', detail: `Key (phone)=(${PHONE}) already exists.` },
  );
}

/** Built exactly like drizzle-orm does for a failed query. */
function queryError(): DrizzleQueryError {
  return new DrizzleQueryError(
    'insert into "tenant_users" ("phone", "password_hash") values ($1, $2)',
    [PHONE, HASH, TOKEN_HASH],
    pgError(),
  );
}

function capture() {
  const lines: string[] = [];
  const stream = new Writable({
    write(chunk: Buffer, _enc, done) {
      lines.push(chunk.toString());
      done();
    },
  });
  const logger = pino(
    {
      redact: { paths: REDACT_PATHS, censor: '[redacted]' }, // pino-http runs pino's standard `err` serializer first, then ours: wrap the same way.
      serializers: {
        err: stdSerializers.wrapErrorSerializer(
          (err) => serializeError(err) as Record<string, unknown>,
        ),
      },
    },
    stream,
  );
  return { lines, logger };
}

function expectNoSecrets(text: string): void {
  for (const secret of [
    PHONE,
    '$argon2id',
    'aGFzaGhhc2g',
    TOKEN_HASH,
    'password_hash',
    'insert into',
  ]) {
    expect(text).not.toContain(secret);
  }
}

describe('serializeError (S-02)', () => {
  it('is not fooled by a bound value that looks like a stack frame (N-2)', () => {
    // A free-text param (a name, a note) can contain a newline followed by "    at …". Cutting
    // the header at the first frame-looking line would keep everything after it, secrets included.
    const err = new DrizzleQueryError(
      'update "tenant_users" set "display_name" = $1, "password_hash" = $2',
      ['Nimali\n    at fake (evil.js:1:1)', HASH, PHONE],
      pgError(),
    );
    const out = JSON.stringify(serializeError(err));
    expectNoSecrets(out);
    expect(out).not.toContain('evil.js');
  });

  it('guards the premise: drizzle puts SQL and params in message and stack', () => {
    const err = queryError();
    expect(err.message).toContain(PHONE);
    expect(err.stack).toContain(HASH);
    expect(err.params).toContain(PHONE);
  });

  it('logs a DrizzleQueryError without SQL, params or detail anywhere in the line', () => {
    const { lines, logger } = capture();
    logger.error({ err: queryError() }, 'Unhandled error while processing request');
    const line = lines.join('');
    expectNoSecrets(line);
    expect(line).not.toContain('already exists'); // the Postgres `detail`

    const logged = JSON.parse(line) as { err: Record<string, unknown> };
    expect(logged.err).toMatchObject({
      type: 'DrizzleQueryError',
      cause: {
        type: 'Error',
        code: '23505',
        message: 'duplicate key value violates unique constraint "tenant_users_phone_key"',
      },
    });
    expect(logged.err.stack).toMatch(/^DrizzleQueryError: query failed\n\s+at /);
    expect(Object.keys(logged.err).sort()).toEqual(['cause', 'message', 'stack', 'type']);
  });

  it('covers a subclass or lookalike that only has `params`', () => {
    class Custom extends Error {
      constructor(readonly params: unknown[]) {
        super(`bad call ${params.join(',')}`);
      }
    }
    const { lines, logger } = capture();
    logger.error({ err: new Custom([PHONE, HASH]) }, 'm');
    expectNoSecrets(lines.join(''));
  });

  it('scrubs a query error wrapped as the cause of an ordinary error, at any depth', () => {
    const inner = new Error('transaction failed', { cause: queryError() });
    const outer = new Error('could not create student', { cause: inner });
    const { lines, logger } = capture();
    logger.error({ err: outer }, 'm');
    const line = lines.join('');
    expectNoSecrets(line);
    expect(line).toContain('could not create student');
    expect(line).toContain('transaction failed');
    expect(line).toContain('23505');
  });

  it('still redacts bound params when the error is logged under another key', () => {
    const { lines, logger } = capture();
    logger.error({ failure: { err: queryError() } }, 'm');
    // Not through the `err` serializer (different key): the redact backstop removes `params`.
    const line = lines.join('');
    expect(line).not.toContain(HASH);
    expect(line).not.toContain(TOKEN_HASH);
  });

  it('removes values Postgres echoes in a bad-syntax message', () => {
    const cause = Object.assign(new Error(`invalid input syntax for type uuid: "${PHONE}"`), {
      code: '22P02',
    });
    const out = serializeError(new DrizzleQueryError('select 1 where id = $1', [PHONE], cause));
    expect(JSON.stringify(out)).not.toContain(PHONE);
    expect(JSON.stringify(out)).toContain('invalid input syntax for type uuid');
  });

  it('terminates on circular causes', () => {
    const a = new Error('a');
    const b = new Error('b', { cause: a });
    (a as { cause?: unknown }).cause = b;
    expect(() => JSON.stringify(serializeError(a))).not.toThrow();
  });

  it('keeps ordinary errors useful: type, message, stack, own fields, cause', () => {
    const err = Object.assign(new TypeError('boom', { cause: new Error('root') }), { status: 502 });
    expect(serializeError(err)).toMatchObject({
      type: 'TypeError',
      message: 'boom',
      status: 502,
      cause: { type: 'Error', message: 'root' },
    });
    expect((serializeError(err) as { stack: string }).stack).toContain('TypeError: boom');
  });

  it('passes non-errors through', () => {
    expect(serializeError('plain')).toBe('plain');
    expect(serializeError(undefined)).toBeUndefined();
  });
});
