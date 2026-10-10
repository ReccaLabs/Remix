import { expect, type Locator } from '@playwright/test';

/**
 * Waits until React has attached to the element (React 19 puts `__reactProps$…` on hydrated DOM
 * nodes). A click, a fill or a key press before that is silently lost, which makes server-rendered
 * pages with client islands flaky; call this on the control you are about to use.
 */
export async function hydrated(control: Locator): Promise<void> {
  await expect
    .poll(() => control.evaluate((el) => Object.keys(el).some((key) => key.startsWith('__reactProps$'))), { message: 'client island hydrated' })
    .toBe(true);
}
