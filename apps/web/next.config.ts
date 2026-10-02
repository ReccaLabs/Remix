import type { NextConfig } from 'next';
import { PHASE_DEVELOPMENT_SERVER } from 'next/constants';
import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

export default function config(phase: string): NextConfig {
  // Same-origin API (ADR 0003): the browser always calls /api/v1/* on the host it is on.
  // Production: Kamal proxy routes /api/v1 to apps/api before Next.js sees it.
  // `next dev` (and local prod-like runs with WEB_API_REWRITE=true at build time): Next.js proxies
  // it. Rewrites are baked in at build time, so a normal production build has none.
  const apiRewrite = phase === PHASE_DEVELOPMENT_SERVER || process.env.WEB_API_REWRITE === 'true';
  const apiUrl = (process.env.API_INTERNAL_URL ?? 'http://localhost:4000').replace(/\/+$/, '');

  return withNextIntl({
    poweredByHeader: false,
    reactStrictMode: true,
    // `next dev` would otherwise write apps/web/AGENTS.md + CLAUDE.md; the repo root CLAUDE.md
    // already holds the rules for AI assistants.
    agentRules: false,
    // Workspace packages ship TypeScript source.
    transpilePackages: ['@remix/ui', '@remix/types'],
    async rewrites() {
      if (!apiRewrite) return [];
      // External rewrite: Next.js forwards with Host = the API's host and sets
      // X-Forwarded-Host = the browser's Host (incl. port). See README "Same-origin API".
      return [{ source: '/api/v1/:path*', destination: `${apiUrl}/api/v1/:path*` }];
    },
    async headers() {
      // The proxy sets the full header set on pages; these cover what it skips (build assets).
      return [
        {
          source: '/_next/:path*',
          headers: [{ key: 'X-Content-Type-Options', value: 'nosniff' }],
        },
      ];
    },
  });
}
