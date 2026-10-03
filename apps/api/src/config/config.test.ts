import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from './config';

/** The smallest valid production environment. */
const PRODUCTION = {
  NODE_ENV: 'production',
  TENANT_BASE_DOMAINS: 'remix.lk',
  TRUST_PROXY: '10.0.0.0/8',
  VALKEY_URL: 'redis://valkey:6379',
};

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

  it('reads VALKEY_URL; empty or missing is unset outside production', () => {
    expect(loadConfig({ VALKEY_URL: 'redis://127.0.0.1:6379' }).valkeyUrl).toBe(
      'redis://127.0.0.1:6379',
    );
    expect(loadConfig({ VALKEY_URL: '' }).valkeyUrl).toBeUndefined();
    expect(loadConfig({}).valkeyUrl).toBeUndefined();
  });

  it('defaults COOKIE_SECURE to true in production', () => {
    const config = loadConfig({ ...PRODUCTION });
    expect(config.cookieSecure).toBe(true);
  });

  describe('TRUST_PROXY in production (S-07)', () => {
    it.each(['loopback', '', 'none', 'loopback, none', '127.0.0.1', '::1', '127.0.0.0/8, ::1/128'])(
      'refuses to boot with %j: every client would share the proxy IP',
      (trustProxy) => {
        const env = { ...PRODUCTION, TRUST_PROXY: trustProxy };
        expect(() => loadConfig(env)).toThrow(ConfigError);
        expect(() => loadConfig(env)).toThrow(
          'TRUST_PROXY: must list the edge proxy / web node addresses in production',
        );
      },
    );

    it('refuses the unset default too', () => {
      const env = { NODE_ENV: 'production', TENANT_BASE_DOMAINS: 'remix.lk' };
      expect(() => loadConfig(env)).toThrow(/TRUST_PROXY/);
    });

    it.each(['uniquelocal', '10.0.0.0/8', 'loopback, 172.16.0.0/12', '10.0.0.5, 10.0.0.6'])(
      'boots with %j',
      (trustProxy) => {
        expect(() => loadConfig({ ...PRODUCTION, TRUST_PROXY: trustProxy })).not.toThrow();
      },
    );

    it('keeps loopback as the dev and test default', () => {
      expect(() => loadConfig({ NODE_ENV: 'development' })).not.toThrow();
      expect(() => loadConfig({ NODE_ENV: 'test', TRUST_PROXY: 'loopback' })).not.toThrow();
    });
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
    [{ VALKEY_URL: 'http://valkey:6379' }, 'VALKEY_URL'],
    [{ ...PRODUCTION, VALKEY_URL: '' }, 'VALKEY_URL'],
    [{ ...PRODUCTION, COOKIE_SECURE: 'false' }, 'COOKIE_SECURE'],
    [{ NODE_ENV: 'production', TRUST_PROXY: '10.0.0.0/8' }, 'TENANT_BASE_DOMAINS'],
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
