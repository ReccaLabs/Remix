import { expect, type Page } from '@playwright/test';

/**
 * Collects console errors, uncaught page errors and CSP violations of a page, across every
 * document it loads (the app navigates with full page loads). `expectClean()` fails with all of
 * them listed. The CSP listener is installed before any page script runs. `ignore` drops known,
 * documented problems by pattern.
 */
export async function watchPageHealth(
  page: Page,
  { ignore = [] }: { ignore?: readonly RegExp[] } = {},
): Promise<{ expectClean: () => void }> {
  const problems: string[] = [];
  const record = (problem: string) => {
    if (!ignore.some((pattern) => pattern.test(problem))) problems.push(problem);
  };

  await page.exposeFunction('__reportCspViolation', (detail: string) => {
    record(`CSP violation: ${detail}`);
  });
  await page.addInitScript(() => {
    document.addEventListener('securitypolicyviolation', (event) => {
      const report = (window as unknown as { __reportCspViolation?: (detail: string) => void })
        .__reportCspViolation;
      report?.(`${event.violatedDirective} blocked ${event.blockedURI || 'inline'}`);
    });
  });
  page.on('console', (message) => {
    if (message.type() === 'error') {
      record(`console.error: ${message.text()} (${message.location().url})`);
    }
  });
  page.on('pageerror', (error) => {
    record(`page error: ${error.message}`);
  });

  return { expectClean: () => expect(problems, 'console errors / CSP violations').toEqual([]) };
}
