import type { MDXContent } from 'mdx/types';
import type { GuideSlug } from './guides';

/**
 * MDX bodies per slug. Static import paths so the bundler (Turbopack) can see every file.
 * Adding a guide = new entry in GUIDES + a file in ./en/ + a line here (typecheck enforces it).
 */
const LOADERS: Record<GuideSlug, () => Promise<{ default: MDXContent }>> = {
  'how-to-start-an-online-tuition-class': () =>
    import('./en/how-to-start-an-online-tuition-class.mdx'),
  'stop-zoom-link-sharing': () => import('./en/stop-zoom-link-sharing.mdx'),
  'collect-fees-without-chasing': () => import('./en/collect-fees-without-chasing.mdx'),
  'run-a-mixed-hall-and-zoom-class': () => import('./en/run-a-mixed-hall-and-zoom-class.mdx'),
};

export async function loadGuideBody(slug: GuideSlug): Promise<MDXContent> {
  return (await LOADERS[slug]()).default;
}
