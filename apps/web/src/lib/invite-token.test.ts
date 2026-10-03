import { describe, expect, it, vi } from 'vitest';
import { readInviteToken } from './invite-token';

const TOKEN = 'A'.repeat(20) + '_-' + 'b'.repeat(21);

function setup(hash: string) {
  const replaceState = vi.fn();
  const token = readInviteToken(
    { hash, pathname: '/admin/invite', search: '' },
    { replaceState, state: null },
  );
  return { token, replaceState };
}

describe('readInviteToken', () => {
  it('reads a well-formed token and strips the fragment from the URL', () => {
    const { token, replaceState } = setup(`#${TOKEN}`);
    expect(token).toBe(TOKEN);
    expect(replaceState).toHaveBeenCalledWith(null, '', '/admin/invite');
  });

  it('rejects missing and malformed tokens (still stripping what was there)', () => {
    expect(setup('').token).toBeNull();
    expect(setup('').replaceState).not.toHaveBeenCalled();
    const bad = setup('#not-a-token');
    expect(bad.token).toBeNull();
    expect(bad.replaceState).toHaveBeenCalledOnce();
    expect(setup(`#${TOKEN}x`).token).toBeNull();
  });
});
