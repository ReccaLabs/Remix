import { describe, expect, it } from 'vitest';
import { pickAuthCookies } from './cookies';

describe('pickAuthCookies', () => {
  it('keeps only ReMix session and device cookies', () => {
    expect(
      pickAuthCookies('_ga=GA1.2.3; remix_session=abc.def; theme=dark; remix_device=xyz'),
    ).toBe('remix_session=abc.def; remix_device=xyz');
    expect(pickAuthCookies('__Host-remix_session=s1;__Host-remix_device=d1;other=1')).toBe(
      '__Host-remix_session=s1; __Host-remix_device=d1',
    );
  });

  it('returns null when there is nothing to forward', () => {
    expect(pickAuthCookies(null)).toBeNull();
    expect(pickAuthCookies('')).toBeNull();
    expect(pickAuthCookies('_ga=1; theme=dark')).toBeNull();
  });

  it('ignores look-alike names and malformed pairs', () => {
    expect(
      pickAuthCookies('remix_session_x=1; xremix_session=2; =remix_session; remix_session'),
    ).toBeNull();
    expect(pickAuthCookies('REMIX_SESSION=1')).toBeNull();
  });
});
