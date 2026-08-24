import { expect, test, type Page } from '@playwright/test';
import { currentSpread, readerNumberAttribute } from './reader-page-harness';
import { installReaderWorkerProbe, readReaderWorkerOperations } from './reader-worker-probe';

const READER_LOAD_TIMEOUT_MS = 90_000;

test.describe('reader app partial-extent navigation', () => {
  test.beforeEach(async ({ page }) => {
    await installReaderWorkerProbe(page);
    await page.goto('/');
    await page.evaluate(() => {
      localStorage.clear();
    });
    await page.reload();
  });

  // FIXME(fragment-source-locator): pre-existing gap of the fragment
  // cutover, on record since the backend landed ("source locators still
  // resolve Unavailable" in chapter_engine_session/fragment). Tracked for
  // the post-release fragment interaction pass together with search
  // source resolution.
  test.fixme('keeps Next enabled at a partial known-extent boundary and grows it', async ({
    page,
  }) => {
    await loadDemoBook(page);
    await expect.poll(() => hasIncompleteRevision(page)).toBe(true);

    await openReaderContextMenu(page);
    await expect(page.getByRole('menuitem', { name: /Previous Page/ })).toHaveAttribute(
      'data-disabled',
      '',
    );
    await page.keyboard.press('Escape');

    const knownSpreadCount = await readerNumberAttribute(page, 'data-total-spreads');
    const knownLastSpread = knownSpreadCount - 1;
    await page.keyboard.press('End');
    await expect.poll(() => currentSpread(page)).toBe(knownLastSpread);

    await openReaderContextMenu(page);
    const next = page.getByRole('menuitem', { name: /Next Page/ });
    await expect(next).not.toHaveAttribute('data-disabled', '');
    await next.click();

    await expect
      .poll(() => readerNumberAttribute(page, 'data-total-spreads'))
      .toBeGreaterThan(knownSpreadCount);
    await expect.poll(() => currentSpread(page)).toBeGreaterThan(knownLastSpread);

    await openReaderContextMenu(page);
    await expect(page.getByRole('menuitem', { name: /Previous Page/ })).not.toHaveAttribute(
      'data-disabled',
      '',
    );
  });
});

async function loadDemoBook(page: Page): Promise<void> {
  const shell = page.getByTestId('reader-shell');
  await expect(page.getByTestId('reader-empty')).toBeVisible();
  await page.getByTestId('load-demo-button').click();
  await expect(shell).toHaveAttribute('data-loaded', 'true', {
    timeout: READER_LOAD_TIMEOUT_MS,
  });
}

async function openReaderContextMenu(page: Page): Promise<void> {
  await page.getByTestId('reader-context-trigger').click({ button: 'right' });
}

async function hasIncompleteRevision(page: Page): Promise<boolean> {
  const observations = await readReaderWorkerOperations(page);
  return observations.some(
    (entry) =>
      entry.revision !== null &&
      entry.revision.status !== null &&
      entry.revision.status !== 'complete',
  );
}
