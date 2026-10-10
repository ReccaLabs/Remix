import { z } from 'zod';
import { parseTrustedProxies, type TrustedProxies } from '../common/http/trusted-proxy';
import { normaliseHost } from '../common/http/forwarded';
import type { S3StorageConfig } from '../integrations/storage/storage.s3';

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

/**
 * Development/test fallback for `AUTH_CODE_SECRET`. Public on purpose (it is in the repo), so it
 * protects nothing: the API refuses it in production.
 */
export const DEV_AUTH_CODE_SECRET = 'remix-dev-only-auth-code-secret-never-in-production';

/** Optional env value: unset or empty -> undefined. */
const optionalText = (max: number) =>
  z.string().trim().min(1).max(max).optional().or(z.literal('').transform(() => undefined));

const SMS_GATEWAYS = ['notifylk', 'textlk'] as const;
export type SmsGatewayName = (typeof SMS_GATEWAYS)[number];

const bool = z.enum(['true', 'false', '1', '0']).transform((v) => v === 'true' || v === '1');

/** Optional string env value: empty means unset. */
const optional = <T extends z.ZodType>(schema: T) =>
  schema.optional().or(z.literal('').transform(() => undefined));

/** The S3 settings that must be given together (ADR 0009 storage). */
const STORAGE_REQUIRED = [
  'STORAGE_S3_ENDPOINT',
  'STORAGE_S3_BUCKET',
  'STORAGE_S3_ACCESS_KEY_ID',
  'STORAGE_S3_SECRET_ACCESS_KEY',
] as const;

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
    INTEGRATIONS_KEY: z.string().regex(/^[A-Za-z0-9+/]{43}=$/, 'must be 32 bytes encoded as base64').optional()
      .or(z.literal('').transform(() => undefined)),
    INTEGRATIONS_KEY_ID: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/).default('v1'),
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
    /**
     * Valkey/Redis connection string: rate limits (C6) and BullMQ jobs (ADR 0012). Required in
     * production; in development and tests the API falls back to the in-memory limiter without it.
     */
    VALKEY_URL: z
      .url({ protocol: /^rediss?$/ })
      .optional()
      .or(z.literal('').transform(() => undefined)),
    /**
     * HMAC key for SMS one-time codes (ADR 0004 addendum): at least 32 characters, its own secret
     * (never the session or database secret). Required in production for the API; development
     * and tests fall back to {@link DEV_AUTH_CODE_SECRET}.
     */
    AUTH_CODE_SECRET: z
      .string()
      .min(32, 'must be at least 32 characters')
      .max(512)
      .optional()
      .or(z.literal('').transform(() => undefined)),
    /** MSG-01 platform SMS gateways. Credentials are secrets: env only, never logged. */
    NOTIFYLK_USER_ID: optionalText(40),
    NOTIFYLK_API_KEY: optionalText(200),
    NOTIFYLK_SENDER_ID: optionalText(11),
    TEXTLK_API_TOKEN: optionalText(300),
    TEXTLK_SENDER_ID: optionalText(11),
    SMS_PRIMARY: z.enum(SMS_GATEWAYS).default('notifylk'),
    SMS_FALLBACK: z
      .enum(SMS_GATEWAYS)
      .optional()
      .or(z.literal('').transform(() => undefined)),
    SMS_HTTP_TIMEOUT_MS: z.coerce.number().int().min(1000).max(30000).default(8000),
    /**
     * Private S3-compatible bucket (ADR 0009): Cloudflare R2 in production, the SeaweedFS of
     * infra/docker in development. All four of endpoint, bucket and keys, or none (then the
     * in-memory mock outside production, and a provider that fails every call in production).
     */
    STORAGE_S3_ENDPOINT: optional(z.url({ protocol: /^https?$/ })),
    /** Origin in presigned URLs when browsers reach the bucket elsewhere than the API does. */
    STORAGE_S3_PUBLIC_ENDPOINT: optional(z.url({ protocol: /^https?$/ })),
    STORAGE_S3_REGION: z.string().regex(/^[a-z0-9-]{1,32}$/).default('auto'),
    STORAGE_S3_BUCKET: optional(z.string().regex(/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/, 'is not a valid bucket name')),
    STORAGE_S3_ACCESS_KEY_ID: optional(z.string().min(1).max(256)),
    STORAGE_S3_SECRET_ACCESS_KEY: optional(z.string().min(1).max(512)),
    STORAGE_S3_FORCE_PATH_STYLE: bool.default(true),
  })
  .transform((env) => ({
    ...env,
    COOKIE_SECURE: env.COOKIE_SECURE ?? env.NODE_ENV === 'production',
  }))
  .superRefine((env, ctx) => {
    if (env.SMS_FALLBACK && env.SMS_FALLBACK === env.SMS_PRIMARY) {
      ctx.addIssue({ code: 'custom', path: ['SMS_FALLBACK'], message: 'must differ from SMS_PRIMARY' });
    }
    const storageSet = STORAGE_REQUIRED.filter((name) => env[name] !== undefined);
    if (storageSet.length > 0 && storageSet.length < STORAGE_REQUIRED.length) {
      for (const name of STORAGE_REQUIRED.filter((n) => env[n] === undefined)) {
        ctx.addIssue({ code: 'custom', path: [name], message: 'required when any STORAGE_S3_* is set' });
      }
    }
    if (env.NODE_ENV !== 'production') return;
    for (const name of ['STORAGE_S3_ENDPOINT', 'STORAGE_S3_PUBLIC_ENDPOINT'] as const) {
      const value = env[name];
      if (value && !value.startsWith('https://')) {
        ctx.addIssue({ code: 'custom', path: [name], message: 'must use https in production' });
      }
    }
    if (!env.INTEGRATIONS_KEY) {
      ctx.addIssue({ code: 'custom', path: ['INTEGRATIONS_KEY'], message: 'required in production (AES-256-GCM)' });
    }
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
    if (!env.VALKEY_URL) {
      ctx.addIssue({
        code: 'custom',
        path: ['VALKEY_URL'],
        message: 'required in production (rate limits and job queues)',
      });
    }
    if (env.AUTH_CODE_SECRET === DEV_AUTH_CODE_SECRET) {
      ctx.addIssue({
        code: 'custom',
        path: ['AUTH_CODE_SECRET'],
        message: 'must not be the development value in production',
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
  /** Valkey connection string; undefined only outside production. */
  valkeyUrl: string | undefined;
  /** HMAC key for SMS codes; the public dev value outside production when unset. */
  authCodeSecret: string;
  integrationsKey: string | undefined;
  integrationsKeyId: string;
  sms: SmsConfig;
  /** S3-compatible storage; undefined when not configured (mock outside production). */
  storage: S3StorageConfig | undefined;
}

/** Platform SMS gateways (MSG-01). A gateway with incomplete credentials is simply absent. */
export interface SmsConfig {
  primary: SmsGatewayName;
  fallback: SmsGatewayName | undefined;
  timeoutMs: number;
  notifyLk: { userId: string; apiKey: string; senderId: string } | undefined;
  textLk: { apiToken: string; senderId: string } | undefined;
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
  // Only the API process hashes SMS codes; the worker never needs the key.
  if (options.requireDatabase && e.NODE_ENV === 'production' && !e.AUTH_CODE_SECRET) {
    throw new ConfigError(['AUTH_CODE_SECRET: required in production (HMAC key for SMS codes)']);
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
    valkeyUrl: e.VALKEY_URL,
    authCodeSecret: e.AUTH_CODE_SECRET ?? DEV_AUTH_CODE_SECRET,
    integrationsKey: e.INTEGRATIONS_KEY,
    integrationsKeyId: e.INTEGRATIONS_KEY_ID,
    sms: {
      primary: e.SMS_PRIMARY,
      fallback: e.SMS_FALLBACK,
      timeoutMs: e.SMS_HTTP_TIMEOUT_MS,
      notifyLk:
        e.NOTIFYLK_USER_ID && e.NOTIFYLK_API_KEY && e.NOTIFYLK_SENDER_ID
          ? { userId: e.NOTIFYLK_USER_ID, apiKey: e.NOTIFYLK_API_KEY, senderId: e.NOTIFYLK_SENDER_ID }
          : undefined,
      textLk:
        e.TEXTLK_API_TOKEN && e.TEXTLK_SENDER_ID
          ? { apiToken: e.TEXTLK_API_TOKEN, senderId: e.TEXTLK_SENDER_ID }
          : undefined,
    },
    storage:
      e.STORAGE_S3_ENDPOINT && e.STORAGE_S3_BUCKET && e.STORAGE_S3_ACCESS_KEY_ID && e.STORAGE_S3_SECRET_ACCESS_KEY
        ? {
            endpoint: e.STORAGE_S3_ENDPOINT,
            ...(e.STORAGE_S3_PUBLIC_ENDPOINT ? { publicEndpoint: e.STORAGE_S3_PUBLIC_ENDPOINT } : {}),
            region: e.STORAGE_S3_REGION,
            bucket: e.STORAGE_S3_BUCKET,
            accessKeyId: e.STORAGE_S3_ACCESS_KEY_ID,
            secretAccessKey: e.STORAGE_S3_SECRET_ACCESS_KEY,
            forcePathStyle: e.STORAGE_S3_FORCE_PATH_STYLE,
          }
        : undefined,
  };
}

/** DI token for the validated {@link AppConfig}. */
export const APP_CONFIG = Symbol('APP_CONFIG');
