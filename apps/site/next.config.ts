import createMDX from '@next/mdx';
import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

// Guides are MDX files in src/content/guides/, imported by the guides pages (they are not routes,
// so pageExtensions stays default). Components come from src/mdx-components.tsx.
// No remark/rehype plugins: Turbopack needs serialisable loader options.
const withMDX = createMDX();

const config: NextConfig = {
  // Static HTML → Cloudflare Pages. No Node server for remix.lk (see DEVELOPMENT.md §0.1).
  output: 'export',
  trailingSlash: true,
  images: { unoptimized: true },
  poweredByHeader: false,
  reactStrictMode: true,
  // Workspace packages ship TypeScript source.
  transpilePackages: ['@remix/ui', '@remix/types'],
  // Security headers live in public/_headers (static export can't set them here).
};

export default withNextIntl(withMDX(config));
