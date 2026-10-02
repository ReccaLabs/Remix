import { describe, expect, it } from 'vitest';
import { resolveRequestId } from './request-headers';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('resolveRequestId', () => {
  it('keeps a well-formed upstream id', () => {
    expect(resolveRequestId('0193f1c2-7b1d-7c3e-9a4f-2b9c1d0e8f7a')).toBe(
      '0193f1c2-7b1d-7c3e-9a4f-2b9c1d0e8f7a',
    );
    expect(resolveRequestId('kamal-proxy.req:12345')).toBe('kamal-proxy.req:12345');
  });

  it.each([
    null,
    '',
    'short',
    'has space in it',
    'line\nbreak-injected',
    'x'.repeat(129),
    '<script>',
  ])('mints a fresh id for %j', (incoming) => {
    expect(resolveRequestId(incoming)).toMatch(UUID);
  });
});
