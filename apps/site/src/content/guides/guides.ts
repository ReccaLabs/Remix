/**
 * Guides index — the single typed list of published articles.
 * Each entry's body lives in ./en/<slug>.mdx (English only for now; loaded via ./content.ts).
 * Titles and descriptions are article content, so they live here with the article, not in messages.
 */

/** Topic filters, in the order shown on /guides (labels: messages/en/guides.json → categories). */
export const GUIDE_CATEGORIES = [
  'gettingStarted',
  'onlineClasses',
  'fees',
  'protectingLessons',
  'attendance',
] as const;

export type GuideCategory = (typeof GUIDE_CATEGORIES)[number];

export interface Guide {
  slug: string;
  title: string;
  description: string;
  category: GuideCategory;
  /** ISO date (YYYY-MM-DD), Asia/Colombo. */
  published: string;
  updated?: string;
  /** Kept in sync with the MDX word count by guides.test.ts (see readingMinutes). */
  readingMinutes: number;
  featured?: boolean;
}

const DATA = [
  {
    slug: 'how-to-start-an-online-tuition-class',
    title: 'How to start an online tuition class in Sri Lanka',
    description:
      'Equipment, Zoom setup, collecting fees and keeping your recordings safe, from your first ten students to your first hundred.',
    category: 'gettingStarted',
    published: '2026-09-25',
    readingMinutes: 8,
    featured: true,
  },
  {
    slug: 'stop-zoom-link-sharing',
    title: 'Stop Zoom link sharing for good',
    description: 'Why links leak, and how name-locked joins end it.',
    category: 'protectingLessons',
    published: '2026-09-25',
    readingMinutes: 5,
  },
  {
    slug: 'collect-fees-without-chasing',
    title: 'Collecting fees without chasing students on WhatsApp',
    description: 'Reminders, due dates and locked lessons that do it for you.',
    category: 'fees',
    published: '2026-09-25',
    readingMinutes: 5,
  },
  {
    slug: 'run-a-mixed-hall-and-zoom-class',
    title: 'Running a mixed class: hall and Zoom at the same time',
    description: 'Camera, microphone and seating that work for both groups.',
    category: 'onlineClasses',
    published: '2026-09-25',
    readingMinutes: 5,
  },
] as const satisfies readonly Guide[];

export type GuideSlug = (typeof DATA)[number]['slug'];

export type GuideEntry = Guide & { slug: GuideSlug };

/** Shown on /guides in this order (the featured guide goes on top). */
export const GUIDES: readonly GuideEntry[] = DATA;

export function getGuide(slug: string): GuideEntry | undefined {
  return GUIDES.find((g) => g.slug === slug);
}

const WORDS_PER_MINUTE = 200;

/** Reading time for an MDX/Markdown source: words ÷ 200, rounded up, at least 1 minute. */
export function readingMinutes(source: string): number {
  const text = source
    .replace(/^(import|export)\s.*$/gm, '') // MDX ESM lines
    .replace(/<[^>]+>/g, ' ') // JSX / HTML tags
    .replace(/\]\([^)]*\)/g, ']') // link targets
    .replace(/[#>*_`|[\]-]/g, ' '); // Markdown punctuation
  const words = text.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
  return Math.max(1, Math.ceil(words / WORDS_PER_MINUTE));
}
