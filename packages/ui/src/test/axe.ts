import axe from 'axe-core';
import { expect } from 'vitest';

/**
 * Runs axe-core against a rendered container and fails with a readable list of violations.
 * Colour contrast is off: jsdom has no CSS, so it can't compute it (tokens are AA-checked in
 * theme.css and in Playwright on real pages). Only violations are collected — gathering passes and
 * incomplete results is most of axe's cost and the tests never read them.
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
