import { z } from 'zod';
import { parseTrustedProxies, type TrustedProxies } from '../common/http/trusted-proxy';
import { normaliseHost } from '../common/http/forwarded';

const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'] as const;

/** Comma-separated env value → trimmed, non-empty, de-duplicated list. */
const list = z.string().transform((v) => [
  ...new Set(
    v
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  ),
]);

/** A list of bare host names (no scheme, port or path), lower-cased. */
const hostList = list
  .pipe(
    z.array(
      z.string().transform((h, ctx) => {
        const host = normaliseHost(h);
        if (!host || host !== h.toLowerCase()) {
          ctx.addIssue({ code: 'custom', message: `"${h}" is not a bare host name` });
          return z.NEVER;
        }
        return host;
      }),
    ),
  )
  .transform((hosts) => [...new Set(hosts)]);

const bool = z.enum(['true', 'false', '1', '0']).transform((v) => v === 'true' || v === '1');

/**
 * True when no real proxy is trusted: empty, `none`, or only loopback. In production the API sits
 * behind the edge proxy and web nodes; trusting none of them makes every client's IP the proxy's,
 * so every per-IP rate limit (and audit IP) would merge all users into one.
 */
function onlyLoopback(entries: readonly string[]): boolean {
  return entries.every(
    (e) =>
      e === 'loopback' || e === 'none' || e === '::1' || e.startsWith('::1/') || /^127\./.test(e),
  );
}

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().min(1).max(65535).default(4000),
    LOG_LEVEL: z.enum(LOG_LEVELS).default('info'),
    /**
     * Proxy addresses/CIDRs whose `X-Forwarded-Host` / `X-Forwarded-For` are honoured. Also accepts
     * the keywords `loopback`, `linklocal`, `uniquelocal`. Everything else is treated as the client.
     */
    TRUST_PROXY: z
      .string()
      .prefault('loopback')
      .transform((v, ctx) => {
        try {
          return parseTrustedProxies(v);
        } catch (error) {
          ctx.addIssue({ code: 'custom', message: (error as Error).message });
          return z.NEVER;
        }
      }),
    /** Hosts whose sub-domains are institute slugs (`remix.lk` in prod, `localhost` in dev). */
    TENANT_BASE_DOMAINS: hostList.default(['localhost']),
    /** Hosts that serve the platform admin area (no tenant), e.g. `admin.remix.lk`. */
    PLATFORM_HOSTS: hostList.default(['admin.localhost']),
    /** `Secure` flag on cookies. Must be on in production. */
    COOKIE_SECURE: bool.optional(),
    /** Postgres connection string as `remix_app`. Required when the database modules run. */
    DATABASE_URL: z
      .url({ protocol: /^postgres(ql)?$/ })
      .optional()
      .or(z.literal('').transform(() => undefined)),
  })
  .transform((env) => ({
    ...env,
    COOKIE_SECURE: env.COOKIE_SECURE ?? env.NODE_ENV === 'production',
  }))
  .superRefine((env, ctx) => {
    if (env.NODE_ENV !== 'production') return;
    if (!env.COOKIE_SECURE) {
      ctx.addIssue({
        code: 'custom',
        path: ['COOKIE_SECURE'],
        message: 'must be true in production',
      });
    }
    if (onlyLoopback(env.TRUST_PROXY.entries)) {
      ctx.addIssue({
        code: 'custom',
        path: ['TRUST_PROXY'],
        message: 'must list the edge proxy / web node addresses in production',
      });
    }
    if (env.TENANT_BASE_DOMAINS.includes('localhost')) {
      ctx.addIssue({
        code: 'custom',
        path: ['TENANT_BASE_DOMAINS'],
        message: 'must not include localhost in production',
      });
    }
  });

export interface AppConfig {
  nodeEnv: 'development' | 'test' | 'production';
  port: number;
  logLevel: (typeof LOG_LEVELS)[number];
  trustProxy: TrustedProxies;
  tenantBaseDomains: readonly string[];
  platformHosts: readonly string[];
  cookieSecure: boolean;
  databaseUrl: string | undefined;
}

/** Thrown when the environment is invalid. Lists variable names and reasons, never values. */
export class ConfigError extends Error {
  constructor(readonly issues: readonly string[]) {
    super(`Invalid environment configuration:\n${issues.map((i) => `  - ${i}`).join('\n')}`);
    this.name = 'ConfigError';
  }
}

export interface LoadConfigOptions {
  /**
   * The database modules are enabled (the API process): `DATABASE_URL` becomes required.
   * Only core-pipeline tests and the worker (until it has jobs) boot without it.
   */
  requireDatabase?: boolean;
}

/** Parse and validate the process environment. Fails fast on the first boot with bad config. */
export function loadConfig(
  env: NodeJS.ProcessEnv = process.env,
  options: LoadConfigOptions = {},
): AppConfig {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    throw new ConfigError(
      parsed.error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`),
    );
  }
  const e = parsed.data;
  if (options.requireDatabase && !e.DATABASE_URL) {
    throw new ConfigError(['DATABASE_URL: required (connects as remix_app)']);
  }
  return {
    nodeEnv: e.NODE_ENV,
    port: e.PORT,
    logLevel: e.LOG_LEVEL,
    trustProxy: e.TRUST_PROXY,
    tenantBaseDomains: e.TENANT_BASE_DOMAINS,
    platformHosts: e.PLATFORM_HOSTS,
    cookieSecure: e.COOKIE_SECURE,
    databaseUrl: e.DATABASE_URL,
  };
}

/** DI token for the validated {@link AppConfig}. */
export const APP_CONFIG = Symbol('APP_CONFIG');
