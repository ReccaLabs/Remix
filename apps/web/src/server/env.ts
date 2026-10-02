import { z } from 'zod';
import { normalizeHost, type HostConfig } from '@/lib/host';

/**
 * Server environment, validated once with Zod. `instrumentation.ts` calls `getEnv()` at boot so
 * a misconfigured server fails fast instead of serving the wrong tenant. Nothing here is
 * `NEXT_PUBLIC_*`: none of it reaches the browser.
 */

const hostList = z.string().transform((value, ctx) => {
  const raw = value
    .split(',')
    .map((h) => h.trim())
    .filter(Boolean);
  const hosts: string[] = [];
  for (const h of raw) {
    const host = normalizeHost(h);
    if (!host) {
      ctx.addIssue({ code: 'custom', message: `"${h}" is not a valid host name` });
      return z.NEVER;
    }
    hosts.push(host);
  }
  if (hosts.length === 0) {
    ctx.addIssue({ code: 'custom', message: 'List at least one host' });
    return z.NEVER;
  }
  return hosts;
});

export const envSchema = z.object({
  /** Where the web server reaches the API directly (private network), e.g. http://api:4000. */
  API_INTERNAL_URL: z.url({ protocol: /^https?$/ }).transform((url) => url.replace(/\/+$/, '')),
  /** Comma-separated: `remix.lk` (prod), `localhost` (dev). */
  TENANT_BASE_DOMAINS: hostList,
  /** Comma-separated: `admin.remix.lk` (prod), `admin.localhost` (dev). */
  PLATFORM_HOSTS: hostList,
});

export type Env = z.output<typeof envSchema>;

export function parseEnv(source: Record<string, string | undefined>): Env {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    throw new Error(`Invalid apps/web environment:\n${z.prettifyError(result.error)}`);
  }
  return result.data;
}

let cached: Env | undefined;

export function getEnv(): Env {
  cached ??= parseEnv(process.env);
  return cached;
}

export function hostConfig(env: Env = getEnv()): HostConfig {
  return { tenantBaseDomains: env.TENANT_BASE_DOMAINS, platformHosts: env.PLATFORM_HOSTS };
}
