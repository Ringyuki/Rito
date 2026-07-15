import { expect, test, type Page } from '@playwright/test';
import { readerCanvasChecksum, stableReaderCanvasChecksum } from './reader-page-harness';
import { installReaderWorkerProbe, readReaderWorkerOperations } from './reader-worker-probe';

const READER_LOAD_TIMEOUT_MS = 90_000;

test.describe('reader app', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => {
      localStorage.clear();
    });
    await page.reload();
  });

  test('loads the demo EPUB and renders a nonblank canvas', async ({ page }) => {
    await loadDemoBook(page);

    await expect.poll(() => readerAttribute(page, 'data-book-title')).not.toBe('');
    await expect.poll(() => readerNumberAttribute(page, 'data-total-spreads')).toBeGreaterThan(0);
    await expect.poll(() => hasNonBlankCanvas(page)).toBe(true);
  });

  test('supports keyboard page navigation', async ({ page }) => {
    await loadDemoBook(page);

    const firstSpread = await currentSpread(page);
    await page.keyboard.press('ArrowRight');
    await expect.poll(() => currentSpread(page)).toBeGreaterThan(firstSpread);

    await page.keyboard.press('Home');
    await expect.poll(() => currentSpread(page)).toBe(0);

    const lastSpread = (await readerNumberAttribute(page, 'data-total-spreads')) - 1;
    await page.keyboard.press('End');
    await expect.poll(() => currentSpread(page)).toBe(lastSpread);
  });

  test('keeps one populated accessibility mirror after page navigation', async ({ page }) => {
    await loadDemoBook(page);

    const mirror = page.locator('[role="document"][aria-live="polite"]');
    await expect(mirror).toHaveCount(1);
    await expect.poll(() => accessibilityMirrorContentCount(page)).toBeGreaterThan(0);

    const firstSpread = await currentSpread(page);
    await page.keyboard.press('ArrowRight');
    await expect.poll(() => currentSpread(page)).toBeGreaterThan(firstSpread);
    await expect(mirror).toHaveCount(1);
    await expect.poll(() => accessibilityMirrorContentCount(page)).toBeGreaterThan(0);
  });

  test('grows and follows an internal native link beyond the known extent', async ({ page }) => {
    await loadDemoBook(page);

    const link = await findAccessibilityLink(page, 'Section014.xhtml');
    const knownBeforeNavigation = await readerNumberAttribute(page, 'data-total-spreads');
    await link.dispatchEvent('click');
    await expect(page.getByRole('heading', { name: 'Navigate to Chapter' })).toBeVisible();
    await page.getByRole('button', { name: 'Go' }).click();

    await expect
      .poll(() => readerAttribute(page, 'data-active-chapter-href'), {
        timeout: READER_LOAD_TIMEOUT_MS,
      })
      .toContain('Section014.xhtml');
    await expect
      .poll(() => readerNumberAttribute(page, 'data-total-spreads'))
      .toBeGreaterThan(knownBeforeNavigation);
    await expect.poll(() => currentSpread(page)).toBeGreaterThanOrEqual(knownBeforeNavigation);
  });

  test('opens the table of contents and navigates to a chapter', async ({ page }) => {
    await loadDemoBook(page);

    await openReaderContextMenu(page);
    await page.getByRole('menuitem', { name: /Contents/ }).click();
    await expect(page.getByRole('heading', { name: 'Contents' })).toBeVisible();

    await page.getByRole('button', { name: /第1话/ }).click();
    await expect.poll(() => currentSpread(page)).toBeGreaterThan(0);
    await expect
      .poll(() => readerAttribute(page, 'data-active-chapter-href'))
      .toContain('Section001.xhtml');
  });

  test('searches book text and jumps to a result', async ({ page }) => {
    await loadDemoBook(page);

    await openReaderContextMenu(page);
    await page.getByRole('menuitem', { name: /^Search/ }).click();
    await page.getByTestId('reader-search-input').fill('真昼');

    await expect(page.getByText(/\d+ results/)).toBeVisible();
    await expect.poll(() => readerNumberAttribute(page, 'data-search-results')).toBeGreaterThan(0);

    const beforeSearchJump = await currentSpread(page);
    await page.getByTestId('reader-search-next-button').click();

    await expect
      .poll(() => readerNumberAttribute(page, 'data-search-active-page'))
      .toBeGreaterThan(0);
    await expect.poll(() => currentSpread(page)).toBeGreaterThan(beforeSearchJump);
  });

  test('paints an exact native search highlight from the committed source range', async ({
    page,
  }) => {
    await installReaderWorkerProbe(page);
    await page.evaluate(() => {
      localStorage.clear();
    });
    await page.reload();
    await loadDemoBook(page);

    await openReaderContextMenu(page);
    await page.getByRole('menuitem', { name: /^Search/ }).click();
    await page.getByTestId('reader-search-input').fill('第1话');
    await expect(page.getByTestId('reader-search-result').first()).toBeVisible();
    await page.getByTestId('reader-search-result').first().click();

    await expect
      .poll(async () => {
        const operations = await readReaderWorkerOperations(page);
        return operations.some(
          (operation) =>
            operation.kind === 'resolveExactSourceRangeAtRevision' && operation.ok === true,
        );
      })
      .toBe(true);
    const highlighted = await stableReaderCanvasChecksum(page);

    await openReaderContextMenu(page);
    await page.getByRole('menuitem', { name: /^Search/ }).click();
    await page.getByTestId('reader-search-input').fill('');
    await expect(page.getByTestId('reader-shell')).toHaveAttribute('data-search-results', '0');
    await expect.poll(() => readerCanvasChecksum(page)).not.toBe(highlighted);
    const clean = await stableReaderCanvasChecksum(page);

    expect(clean).not.toBe(highlighted);
  });

  test('applies settings that trigger reader reflow and theme changes', async ({ page }) => {
    await loadDemoBook(page);

    await openReaderContextMenu(page);
    await page.getByRole('menuitem', { name: /Reader Settings/ }).click();
    await expect(page.getByRole('heading', { name: 'Reader Settings' })).toBeVisible();

    await page.getByRole('button', { name: 'Single Page' }).click();
    await expect(page.getByTestId('reader-shell')).toHaveAttribute('data-spread-mode', 'single');
    await expect.poll(() => readerNumberAttribute(page, 'data-total-spreads')).toBeGreaterThan(0);

    await page.getByRole('button', { name: 'Greedy' }).click();
    await expect(page.getByTestId('reader-shell')).toHaveAttribute('data-line-breaking', 'greedy');
    await expect.poll(() => readerNumberAttribute(page, 'data-total-spreads')).toBeGreaterThan(0);

    await page.getByRole('button', { name: 'Dark' }).click();
    await expect(page.getByTestId('reader-shell')).toHaveAttribute('data-theme', 'dark');
  });
});

test.describe('reader app bounded worker session', () => {
  test('loads the demo through the production bounded protocol', async ({ page }) => {
    await installReaderWorkerProbe(page);
    await page.goto('/');
    await page.evaluate(() => {
      localStorage.clear();
    });
    await page.reload();

    await loadDemoBook(page);
    await expect.poll(() => hasNonBlankCanvas(page)).toBe(true);

    const observations = await readReaderWorkerOperations(page);
    expect(observations.some((entry) => entry.ok === false)).toBe(false);
    expect(observations.map((entry) => entry.kind)).toEqual(
      expect.arrayContaining([
        'open',
        'createBoundedRevision',
        'getRevisionPresentationAtRevision',
        'warmFrameWindowAtRevision',
        'getFootnotesAtRevision',
        'getChapterTextIndicesAtRevision',
      ]),
    );
    expect(observations.some((entry) => entry.kind === 'createViewRevision')).toBe(false);
    const initial = observations.find((entry) => entry.kind === 'createBoundedRevision');
    expect(initial?.maxTopLevelNodes).toBe(1);
    expect(observations.some((entry) => (entry.revision?.knownSpreadCount ?? 0) > 0)).toBe(true);
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

async function currentSpread(page: Page): Promise<number> {
  return readerNumberAttribute(page, 'data-current-spread');
}

async function readerAttribute(page: Page, name: string): Promise<string> {
  return (await page.getByTestId('reader-shell').getAttribute(name)) ?? '';
}

async function readerNumberAttribute(page: Page, name: string): Promise<number> {
  const value = await readerAttribute(page, name);
  return Number(value);
}

async function accessibilityMirrorContentCount(page: Page): Promise<number> {
  return page.locator('[role="document"][aria-live="polite"] > *').count();
}

async function findAccessibilityLink(page: Page, hrefSuffix: string) {
  const mirror = page.locator('[role="document"][aria-live="polite"]');
  for (let attempt = 0; attempt < 16; attempt += 1) {
    const link = mirror.locator(`a[href$="${hrefSuffix}"]`).first();
    if ((await link.count()) > 0) return link;
    const before = await currentSpread(page);
    await page.keyboard.press('ArrowRight');
    await expect.poll(() => currentSpread(page)).toBeGreaterThan(before);
  }
  throw new Error(`Could not find accessibility link ending in ${hrefSuffix}`);
}

async function hasNonBlankCanvas(page: Page): Promise<boolean> {
  return page.locator('canvas').evaluateAll((canvases) =>
    canvases.some((canvas) => {
      if (!(canvas instanceof HTMLCanvasElement)) return false;
      if (canvas.width === 0 || canvas.height === 0) return false;

      const context = canvas.getContext('2d');
      if (!context) return false;

      const sampleStepX = Math.max(1, Math.floor(canvas.width / 40));
      const sampleStepY = Math.max(1, Math.floor(canvas.height / 40));

      for (let y = 0; y < canvas.height; y += sampleStepY) {
        for (let x = 0; x < canvas.width; x += sampleStepX) {
          const pixel = context.getImageData(x, y, 1, 1).data;
          const alpha = pixel[3] ?? 0;
          if (alpha === 0) continue;

          const red = pixel[0] ?? 255;
          const green = pixel[1] ?? 255;
          const blue = pixel[2] ?? 255;
          const distanceFromWhite =
            Math.abs(red - 255) + Math.abs(green - 255) + Math.abs(blue - 255);
          if (distanceFromWhite > 24) return true;
        }
      }

      return false;
    }),
  );
}
