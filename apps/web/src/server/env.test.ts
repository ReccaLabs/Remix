import { describe, expect, it } from 'vitest';
import { hostConfig, parseEnv } from './env';

const valid = {
  API_INTERNAL_URL: 'http://localhost:4000/',
  TENANT_BASE_DOMAINS: 'localhost',
  PLATFORM_HOSTS: 'admin.localhost',
};

describe('parseEnv', () => {
  it('parses and normalises a valid environment', () => {
    const env = parseEnv({
      API_INTERNAL_URL: 'https://api.internal:4000///',
      TENANT_BASE_DOMAINS: ' Remix.LK , staging.remix.lk. ',
      PLATFORM_HOSTS: 'ADMIN.remix.lk',
    });
    expect(env).toEqual({
      API_INTERNAL_URL: 'https://api.internal:4000',
      TENANT_BASE_DOMAINS: ['remix.lk', 'staging.remix.lk'],
      PLATFORM_HOSTS: ['admin.remix.lk'],
    });
    expect(hostConfig(env)).toEqual({
      tenantBaseDomains: ['remix.lk', 'staging.remix.lk'],
      platformHosts: ['admin.remix.lk'],
    });
  });

  it('strips the trailing slash from the API URL', () => {
    expect(parseEnv(valid).API_INTERNAL_URL).toBe('http://localhost:4000');
  });

  it.each([
    ['API_INTERNAL_URL', undefined],
    ['API_INTERNAL_URL', 'localhost:4000'],
    ['API_INTERNAL_URL', 'ftp://api:21'],
    ['API_INTERNAL_URL', 'not a url'],
    ['TENANT_BASE_DOMAINS', undefined],
    ['TENANT_BASE_DOMAINS', ''],
    ['TENANT_BASE_DOMAINS', ' , '],
    ['TENANT_BASE_DOMAINS', 'remix.lk,*.evil.com'],
    ['TENANT_BASE_DOMAINS', '127.0.0.1'],
    ['PLATFORM_HOSTS', undefined],
    ['PLATFORM_HOSTS', 'admin.remix.lk/path'],
  ])('fails fast when %s is %j', (key, value) => {
    expect(() => parseEnv({ ...valid, [key]: value })).toThrow(/Invalid apps\/web environment/);
  });

  it('names the broken variable in the error', () => {
    expect(() => parseEnv({ ...valid, PLATFORM_HOSTS: undefined })).toThrow(/PLATFORM_HOSTS/);
  });
});
