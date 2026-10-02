import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from './config';

describe('loadConfig', () => {
  it('applies dev defaults', () => {
    const config = loadConfig({});
    expect(config).toMatchObject({
      nodeEnv: 'development',
      port: 4000,
      logLevel: 'info',
      tenantBaseDomains: ['localhost'],
      platformHosts: ['admin.localhost'],
      cookieSecure: false,
      databaseUrl: undefined,
    });
    expect(config.trustProxy.entries).toEqual(['loopback']);
    expect(config.trustProxy.isTrusted('127.0.0.1')).toBe(true);
    expect(config.trustProxy.isTrusted('10.0.0.1')).toBe(false);
  });

  it('parses lists, booleans and numbers', () => {
    const config = loadConfig({
      PORT: '8080',
      TENANT_BASE_DOMAINS: ' remix.lk , Remix.lk ,',
      PLATFORM_HOSTS: 'admin.remix.lk',
      TRUST_PROXY: '10.0.0.0/8, 2001:db8::1',
      COOKIE_SECURE: '1',
      DATABASE_URL: 'postgres://remix_app@localhost:5432/remix',
    });
    expect(config.port).toBe(8080);
    expect(config.tenantBaseDomains).toEqual(['remix.lk']);
    expect(config.cookieSecure).toBe(true);
    expect(config.trustProxy.isTrusted('10.1.2.3')).toBe(true);
    expect(config.databaseUrl).toBe('postgres://remix_app@localhost:5432/remix');
  });

  it('treats an empty DATABASE_URL as unset', () => {
    expect(loadConfig({ DATABASE_URL: '' }).databaseUrl).toBeUndefined();
  });

  it('defaults COOKIE_SECURE to true in production', () => {
    const config = loadConfig({ NODE_ENV: 'production', TENANT_BASE_DOMAINS: 'remix.lk' });
    expect(config.cookieSecure).toBe(true);
  });

  it.each([
    [{ PORT: '0' }, 'PORT'],
    [{ PORT: 'abc' }, 'PORT'],
    [{ LOG_LEVEL: 'verbose' }, 'LOG_LEVEL'],
    [{ NODE_ENV: 'staging' }, 'NODE_ENV'],
    [{ TRUST_PROXY: '10.0.0.0/33' }, 'TRUST_PROXY'],
    [{ TRUST_PROXY: 'cloudflare' }, 'TRUST_PROXY'],
    [{ TENANT_BASE_DOMAINS: 'https://remix.lk' }, 'TENANT_BASE_DOMAINS'],
    [{ PLATFORM_HOSTS: 'admin.remix.lk:443' }, 'PLATFORM_HOSTS'],
    [{ COOKIE_SECURE: 'yes' }, 'COOKIE_SECURE'],
    [{ DATABASE_URL: 'mysql://x@y/z' }, 'DATABASE_URL'],
    [
      { NODE_ENV: 'production', COOKIE_SECURE: 'false', TENANT_BASE_DOMAINS: 'remix.lk' },
      'COOKIE_SECURE',
    ],
    [{ NODE_ENV: 'production' }, 'TENANT_BASE_DOMAINS'],
  ])('fails fast on %o', (env, variable) => {
    expect(() => loadConfig(env)).toThrow(ConfigError);
    try {
      loadConfig(env);
    } catch (error) {
      expect((error as ConfigError).issues.join('\n')).toContain(variable);
    }
  });

  it('never echoes values (they may be secrets)', () => {
    try {
      loadConfig({ DATABASE_URL: 'mysql://admin:s3cr3t@db/remix' });
      expect.unreachable();
    } catch (error) {
      expect((error as Error).message).not.toContain('s3cr3t');
    }
  });
});
