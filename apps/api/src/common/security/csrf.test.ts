import { describe, expect, it } from 'vitest';
import { checkCsrf, isJsonContentType } from './csrf';

const own = 'https://kamal.remix.lk';
const json = { 'content-type': 'application/json' };
const check = (method: string, headers: Record<string, string>, ownOrigin: string | null = own) =>
  checkCsrf({ method, headers, ownOrigin });

describe('checkCsrf (ADR 0003)', () => {
  it.each(['GET', 'HEAD', 'OPTIONS', 'get'])('%s always passes', (method) => {
    expect(
      check(method, { origin: 'https://evil.remix.lk', 'sec-fetch-site': 'cross-site' }),
    ).toEqual({
      ok: true,
    });
  });

  describe.each(['POST', 'PUT', 'PATCH', 'DELETE'])('%s', (method) => {
    it('passes same-origin browser requests', () => {
      expect(check(method, { ...json, origin: own, 'sec-fetch-site': 'same-origin' }).ok).toBe(
        true,
      );
    });

    it('passes non-browser requests (no Origin, no Sec-Fetch-Site)', () => {
      expect(check(method, json).ok).toBe(true);
    });

    it('passes Sec-Fetch-Site: none', () => {
      expect(check(method, { ...json, 'sec-fetch-site': 'none' }).ok).toBe(true);
    });

    it.each(['same-site', 'cross-site', 'SAME-SITE', 'garbage'])(
      'rejects Sec-Fetch-Site: %s',
      (site) => {
        expect(check(method, { ...json, 'sec-fetch-site': site })).toEqual({
          ok: false,
          status: 403,
          reason: 'sec-fetch-site',
        });
      },
    );

    it.each([
      'https://evil.remix.lk', // sibling tenant
      'http://kamal.remix.lk', // scheme downgrade
      'https://kamal.remix.lk:8443', // other port
      'https://kamal.remix.lk.evil.com',
      'null',
      '',
      'not a url',
      'file://',
    ])('rejects Origin %j', (origin) => {
      expect(check(method, { ...json, origin })).toEqual({
        ok: false,
        status: 403,
        reason: 'origin',
      });
    });

    it('accepts an Origin differing only in case or default port', () => {
      expect(check(method, { ...json, origin: 'HTTPS://Kamal.Remix.LK:443' }).ok).toBe(true);
    });

    it('rejects every Origin when our own origin is unknown', () => {
      expect(check(method, { ...json, origin: own }, null).ok).toBe(false);
    });

    it.each([
      undefined,
      'text/plain',
      'application/x-www-form-urlencoded',
      'multipart/form-data',
      'application/jsonx',
      'application/merge-patch+json',
    ])('rejects Content-Type %s with 415', (type) => {
      const headers: Record<string, string> = type ? { 'content-type': type } : {};
      expect(check(method, headers)).toEqual({ ok: false, status: 415, reason: 'content-type' });
    });
  });

  it('checks the headers before the content type (a cross-site form gets 403, not 415)', () => {
    expect(
      check('POST', { origin: 'https://evil.remix.lk', 'content-type': 'text/plain' }),
    ).toMatchObject({
      status: 403,
    });
  });
});

describe('isJsonContentType', () => {
  it.each([
    'application/json',
    'Application/JSON',
    'application/json; charset=utf-8',
    ' application/json ;x=y',
  ])('accepts %j', (v) => {
    expect(isJsonContentType(v)).toBe(true);
  });
});
