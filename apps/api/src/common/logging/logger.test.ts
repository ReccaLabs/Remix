import { Writable } from 'node:stream';
import pino from 'pino';
import { describe, expect, it } from 'vitest';
import { pathOnly, REDACT_PATHS } from './logger';

function capture() {
  const lines: Record<string, unknown>[] = [];
  const stream = new Writable({
    write(chunk: Buffer, _enc, done) {
      lines.push(JSON.parse(chunk.toString()) as Record<string, unknown>);
      done();
    },
  });
  return { lines, logger: pino({ redact: { paths: REDACT_PATHS, censor: '[redacted]' } }, stream) };
}

describe('REDACT_PATHS', () => {
  it('censors secrets at the top level and up to two levels deep', () => {
    const { lines, logger } = capture();
    logger.info(
      {
        password: 'a',
        user: { password: 'b', name: 'kept' },
        req: { headers: { cookie: 'sid=1', authorization: 'Bearer x', 'set-cookie': 'y' } },
        token: 'c',
        otp: '123456',
        input: 'CARD-LOOKUP-PRIVATE',
        body: { nfcUid: '04A21B9C', input: 'NFC-LOOKUP-PRIVATE' },
        row: { nfc_uid: '11223344556677' },
      },
      'm',
    );
    const line = JSON.stringify(lines[0]);
    for (const secret of [
      '"a"',
      '"b"',
      'sid=1',
      'Bearer',
      '"c"',
      '123456',
      '"y"',
      '04A21B9C',
      '11223344556677',
      'CARD-LOOKUP-PRIVATE',
      'NFC-LOOKUP-PRIVATE',
    ]) {
      expect(line).not.toContain(secret);
    }
    expect(line).toContain('kept');
  });
});

describe('pathOnly', () => {
  it('drops the query string', () => {
    expect(pathOnly('/api/v1/x?token=abc&phone=077')).toBe('/api/v1/x');
    expect(pathOnly('/health')).toBe('/health');
    expect(pathOnly(undefined)).toBeUndefined();
  });
});
