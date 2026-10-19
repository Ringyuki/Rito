import { expect, test } from '@playwright/test';

// A browser that gives no WebGL2 — hardware acceleration off, a GPU it
// blocks — cannot draw a page: the reader says so before loading anything.
test.use({ launchOptions: { args: ['--disable-3d-apis'] } });

test('says the browser cannot draw the reader where WebGL2 is unavailable', async ({ page }) => {
  await page.goto('/');
  const notice = page.getByTestId('reader-webgl-unavailable');
  await expect(notice).toBeVisible();
  await expect(notice).toContainText('hardware acceleration');
  await expect(page.locator('input[type=file]')).toHaveCount(0);
});
