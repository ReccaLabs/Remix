/**
 * Full page load to `url` (same host). Used after login and logout so every Server Component
 * re-renders with the new cookie and no client router cache survives the change of user.
 * Its own module so component tests can replace it (jsdom can't navigate).
 */
export function hardNavigate(url: string): void {
  window.location.assign(url);
}
