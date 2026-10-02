import { describe, expect, it } from 'vitest';
import { decideRoute, isInternalPath, NOT_FOUND_PATH } from './routing';

const tenant = { area: 'tenant', host: 'kamalphysics.remix.lk' } as const;
const platform = { area: 'platform' } as const;
const unknown = { area: 'unknown' } as const;

describe('decideRoute', () => {
  it('rewrites tenant hosts into /tenant', () => {
    expect(decideRoute('/', tenant)).toEqual({
      action: 'rewrite',
      area: 'tenant',
      pathname: '/tenant',
    });
    expect(decideRoute('/app/classes', tenant)).toEqual({
      action: 'rewrite',
      area: 'tenant',
      pathname: '/tenant/app/classes',
    });
    expect(decideRoute('/admin/login', tenant)).toMatchObject({ pathname: '/tenant/admin/login' });
  });

  it('rewrites the platform host into /platform', () => {
    expect(decideRoute('/', platform)).toEqual({
      action: 'rewrite',
      area: 'platform',
      pathname: '/platform',
    });
    expect(decideRoute('/institutes/42', platform)).toMatchObject({
      pathname: '/platform/institutes/42',
    });
  });

  it('404s unknown hosts on every path', () => {
    expect(decideRoute('/', unknown)).toEqual({ action: 'not-found' });
    expect(decideRoute('/login', unknown)).toEqual({ action: 'not-found' });
  });

  it('404s direct requests to the internal prefixes, whatever the host', () => {
    for (const path of [
      '/tenant',
      '/tenant/',
      '/tenant/app',
      '/platform',
      '/platform/institutes',
      '/TENANT/app',
      '/Platform',
    ]) {
      expect(decideRoute(path, tenant)).toEqual({ action: 'not-found' });
      expect(decideRoute(path, platform)).toEqual({ action: 'not-found' });
    }
  });

  it('does not treat look-alike paths as internal', () => {
    expect(decideRoute('/tenants', tenant)).toMatchObject({ pathname: '/tenant/tenants' });
    expect(decideRoute('/platform-fees', tenant)).toMatchObject({
      pathname: '/tenant/platform-fees',
    });
  });
});

describe('isInternalPath', () => {
  it('matches only whole prefix segments', () => {
    expect(isInternalPath('/tenant')).toBe(true);
    expect(isInternalPath('/platform/x')).toBe(true);
    expect(isInternalPath('/tenantx')).toBe(false);
    expect(isInternalPath('/')).toBe(false);
  });

  it('keeps the not-found target out of every area', () => {
    expect(isInternalPath(NOT_FOUND_PATH)).toBe(false);
    expect(NOT_FOUND_PATH.startsWith('/_')).toBe(true);
  });
});
