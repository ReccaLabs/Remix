import axe from 'axe-core';
import { expect } from 'vitest';

/**
 * Runs axe-core against a rendered container and fails with a readable list of violations.
 * Same rules as packages/ui's helper: colour contrast is off (jsdom has no CSS; tokens are
 * AA-checked in theme.css and on real pages by Playwright).
 */
export async function expectNoAxeViolations(container: Element) {
  const results = await axe.run(container, {
    rules: { 'color-contrast': { enabled: false } },
    resultTypes: ['violations'],
  });
  const summary = results.violations.map(
    (v) => `${v.id}: ${v.help} (${v.nodes.map((n) => n.target.join(' ')).join(', ')})`,
  );
  expect(summary).toEqual([]);
}
