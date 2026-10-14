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
          (operation) => operation.kind === 'exact-source-range' && operation.ok === true,
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

  test('copies a debug log of what the reader was asked and what the tester did', async ({
    page,
    context,
  }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await loadDemoBook(page);
    await expect.poll(() => readerNumberAttribute(page, 'data-total-spreads')).toBeGreaterThan(1);
    const initial = await currentSpread(page);
    await page.keyboard.press('ArrowRight');
    await expect.poll(() => currentSpread(page)).toBeGreaterThan(initial);

    await openReaderContextMenu(page);
    await page.getByTestId('reader-copy-debug-log').click();
    await expect(page.getByText('Debug log copied')).toBeVisible();
    const report = await page.evaluate(() => navigator.clipboard.readText());

    expect(report).toContain('# Rito debug log');
    // The session requests behind the open and the turn, with their outcome.
    expect(report).toMatch(/#1 +openSession .* → \d+(\.\d)? ms/);
    expect(report).toMatch(/#1 +commit +\{scope: "chapter"/);
    expect(report).toMatch(/#1 +commit +\{scope: "book"/);
    expect(report).toMatch(/#1 +commitPeekedArtifact .* → \d+(\.\d)? ms/);
    // What the tester did and what the controller reported for it.
    expect(report).toMatch(/page +key +ArrowRight/);
    expect(report).toMatch(/page +transitionStart +forward/);
    expect(report).not.toContain('FAILED');
    expect(report).not.toContain('NO ANSWER YET');
  });

  test('applies settings that trigger reader reflow and theme changes', async ({ page }) => {
    await loadDemoBook(page);

    await openReaderContextMenu(page);
    await page.getByRole('menuitem', { name: /Reader Settings/ }).click();
    await expect(page.getByRole('heading', { name: 'Reader Settings' })).toBeVisible();

    await page.getByRole('button', { name: 'Single Page' }).click();
    await expect(page.getByTestId('reader-shell')).toHaveAttribute('data-spread-mode', 'single');
    await expect.poll(() => readerNumberAttribute(page, 'data-total-spreads')).toBeGreaterThan(0);

    await page.getByRole('button', { name: 'Dark' }).click();
    await expect(page.getByTestId('reader-shell')).toHaveAttribute('data-theme', 'dark');
  });

  test('applies every font size of a run of changes, however closely they follow', async ({
    page,
  }) => {
    await loadDemoBook(page);
    await expect.poll(() => committedLayout(page)).toMatchObject({ scope: 'book' });

    // A change lands at every point of the layout before it: in the same
    // task, while its page is prepared, while its whole book follows. Every
    // third one is followed by a page turn, which loads spreads meanwhile.
    let fontSize = 16;
    for (const gapMs of [0, 4, 16, 40, 90, 160, 260]) {
      for (let step = 0; step < 6; step += 1) {
        fontSize = fontSize >= 24 ? 15 : fontSize + 1;
        await page.evaluate(
          ({ size, turn }) => {
            const controller = (
              window as unknown as {
                __ritoController: {
                  readonly currentSpread: number;
                  readonly reader: { readonly totalSpreads: number };
                  setTypography(patch: { fontSize: number }): void;
                  jumpToSpread(index: number): void;
                };
              }
            ).__ritoController;
            controller.setTypography({ fontSize: size });
            if (turn) {
              const last = controller.reader.totalSpreads - 1;
              controller.jumpToSpread(Math.min(controller.currentSpread + 1, last));
            }
          },
          { size: fontSize, turn: step % 3 === 2 },
        );
        if (gapMs > 0) await page.waitForTimeout(gapMs);
      }
      await expect.poll(() => committedLayout(page)).toEqual({ scope: 'book', fontSize });
    }
    // The session refused nothing on the way.
    expect(await refusedSessionRequests(page)).toEqual([]);
  });
});

test.describe('reader app session worker', () => {
  test('loads the demo through the reader session protocol', async ({ page }) => {
    await installReaderWorkerProbe(page);
    await page.goto('/');
    await page.evaluate(() => {
      localStorage.clear();
    });
    await page.reload();

    await loadDemoBook(page);
    await expect.poll(() => hasNonBlankCanvas(page)).toBe(true);

    // The whole book follows the chapter the reader opened on.
    await expect.poll(() => readerNumberAttribute(page, 'data-total-spreads')).toBeGreaterThan(0);
    const observations = await readReaderWorkerOperations(page);
    expect(observations.some((entry) => entry.ok === false)).toBe(false);
    const kinds = observations.map((entry) => entry.kind);
    expect(kinds).toEqual(
      expect.arrayContaining([
        'open',
        'adopt-foreground-candidate',
        'navigation',
        'advance-background-once',
        'adopt-background-candidate',
      ]),
    );
    // One protocol: no worker is asked for a revision the old way.
    expect(kinds.filter((kind) => kind === 'open')).toHaveLength(1);
    expect(kinds).not.toContain('createRevision');
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

/** The layout the reader has committed: its scope and root font size. */
async function committedLayout(page: Page): Promise<{ scope: string; fontSize: number }> {
  return page.evaluate(() => {
    const { reader } = (
      window as unknown as {
        __ritoController: {
          reader: { layoutScope: string; getLayoutGeometry(): { rootFontSize: number } };
        };
      }
    ).__ritoController;
    return { scope: reader.layoutScope, fontSize: reader.getLayoutGeometry().rootFontSize };
  });
}

/** The session requests the reader's log shows as refused. */
async function refusedSessionRequests(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const log =
      (
        globalThis as {
          __ritoReaderDiagnostics?: {
            log?: () => { kind: string; failed?: true; result?: string }[];
          };
        }
      ).__ritoReaderDiagnostics?.log?.() ?? [];
    return log
      .filter((entry) => entry.failed === true)
      .map((entry) => `${entry.kind}: ${entry.result ?? ''}`);
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
