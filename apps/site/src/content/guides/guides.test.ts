import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { GUIDES, readingMinutes } from './guides';

const dir = join(import.meta.dirname, 'en');

describe('guides index', () => {
  it('has exactly one MDX file per guide', () => {
    const files = readdirSync(dir)
      .filter((f) => f.endsWith('.mdx'))
      .sort();
    expect(files).toEqual(GUIDES.map((g) => `${g.slug}.mdx`).sort());
  });

  it('has unique slugs and exactly one featured guide', () => {
    expect(new Set(GUIDES.map((g) => g.slug)).size).toBe(GUIDES.length);
    expect(GUIDES.filter((g) => g.featured)).toHaveLength(1);
  });

  it.each(GUIDES.map((g) => [g.slug, g.readingMinutes] as const))(
    '%s shows the reading time of its body',
    (slug, minutes) => {
      expect(readingMinutes(readFileSync(join(dir, `${slug}.mdx`), 'utf8'))).toBe(minutes);
    },
  );
});

describe('readingMinutes', () => {
  it('counts words at 200 per minute, rounding up', () => {
    expect(readingMinutes('word '.repeat(200))).toBe(1);
    expect(readingMinutes('word '.repeat(201))).toBe(2);
  });

  it('ignores Markdown syntax, link targets and MDX exports', () => {
    const src = 'export const x = 1\n\n## Title here\n\n- [a link](/pricing) and `code`\n';
    expect(readingMinutes(src)).toBe(1);
    expect(readingMinutes('')).toBe(1);
  });
});
