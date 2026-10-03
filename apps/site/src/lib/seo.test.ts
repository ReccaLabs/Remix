import { describe, expect, it } from 'vitest';
import { jsonLd } from './seo';

describe('jsonLd', () => {
  it('cannot close the script tag or open an HTML comment', () => {
    const out = jsonLd({ name: '</script><script>alert(1)</script><!--' });
    expect(out).not.toMatch(/[<>]/);
    expect(out).toContain('\\u003c/script\\u003e');
  });

  it('escapes ampersands and line separators', () => {
    const out = jsonLd({ a: 'A & B', b: 'line\u2028sep\u2029end' });
    expect(out).not.toMatch(/[&\u2028\u2029]/);
  });

  it('stays valid JSON with the same meaning', () => {
    const data = { '@type': 'Organization', name: 'Kamal <Physics> & Co\u2028', n: 3 };
    expect(JSON.parse(jsonLd(data))).toEqual(data);
  });
});
