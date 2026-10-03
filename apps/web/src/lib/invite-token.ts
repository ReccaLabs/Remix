/** Invitation tokens are 256 random bits, base64url (43 characters). */
const TOKEN = /^[A-Za-z0-9_-]{43}$/;

/**
 * Read the invitation token from the URL fragment (`/admin/invite#<token>`) and remove the
 * fragment from the address bar and the history entry straight away, so it is not left on
 * screen, in history or in a bookmark. Returns null for a missing or malformed token.
 */
export function readInviteToken(
  location: Pick<Location, 'hash' | 'pathname' | 'search'>,
  history: Pick<History, 'replaceState' | 'state'>,
): string | null {
  const raw = location.hash.startsWith('#') ? location.hash.slice(1) : location.hash;
  if (raw) history.replaceState(history.state, '', `${location.pathname}${location.search}`);
  return TOKEN.test(raw) ? raw : null;
}
