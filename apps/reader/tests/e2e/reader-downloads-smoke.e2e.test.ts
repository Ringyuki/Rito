import { readdirSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';

const EPUB_SMOKE_ROOT = process.env['RITO_EPUB_SMOKE_DIR'];
const EPUB_LOAD_TIMEOUT_MS = 45_000;

test.describe('external EPUB reader smoke', () => {
  test.describe.configure({ mode: 'parallel' });

  if (EPUB_SMOKE_ROOT === undefined) {
    test.skip('requires RITO_EPUB_SMOKE_DIR', () => {});
    return;
  }

  const root = resolve(EPUB_SMOKE_ROOT);
  const epubPaths = discoverEpubPaths(root);

  test('discovers at least one EPUB', () => {
    expect(epubPaths.length).toBeGreaterThan(0);
  });

  for (const epubPath of epubPaths) {
    test(relative(root, epubPath), async ({ page }) => {
      const browserErrors = collectBrowserErrors(page);
      await page.goto('/');
      await page.locator('input[type="file"][accept=".epub"]').first().setInputFiles(epubPath);

      await expect
        .poll(() => readerLoadOutcome(page), {
          message: `Reader failed to load ${epubPath}`,
          timeout: EPUB_LOAD_TIMEOUT_MS,
        })
        .toBe('loaded');
      await expect.poll(() => readerSpreadCount(page)).toBeGreaterThan(0);
      await expect
        .poll(() => hasNonBlankCanvas(page), { timeout: EPUB_LOAD_TIMEOUT_MS })
        .toBe(true);

      expect(browserErrors, browserErrors.join('\n')).toEqual([]);
    });
  }
});

function discoverEpubPaths(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) return discoverEpubPaths(path);
      return entry.isFile() && entry.name.toLowerCase().endsWith('.epub') ? [path] : [];
    })
    .sort((left, right) => left.localeCompare(right));
}

function collectBrowserErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`);
  });
  page.on('pageerror', (error) => {
    errors.push(`page: ${error.stack ?? error.message}`);
  });
  return errors;
}

async function readerLoadOutcome(page: Page): Promise<'pending' | 'loaded'> {
  const shell = page.getByTestId('reader-shell');
  const snapshot = await shell.evaluate((element) => {
    const readerShell = element as HTMLElement;
    const error = readerShell.querySelector('[data-testid="reader-error"]');
    if (error !== null) {
      return { status: 'error' as const, message: error.textContent.trim() };
    }
    if (readerShell.dataset['loaded'] === 'true') return { status: 'loaded' as const };
    if (
      readerShell.dataset['loading'] === 'true' ||
      readerShell.querySelector('[data-testid="reader-empty"]') !== null
    ) {
      return { status: 'pending' as const };
    }
    return { status: 'error' as const, message: readerShell.innerText.trim() };
  });
  if (snapshot.status !== 'error') return snapshot.status;
  throw new Error(snapshot.message || 'Reader stopped loading without an error');
}

async function readerSpreadCount(page: Page): Promise<number> {
  return Number((await page.getByTestId('reader-shell').getAttribute('data-total-spreads')) ?? 0);
}

async function hasNonBlankCanvas(page: Page): Promise<boolean> {
  return page.locator('canvas').evaluateAll((canvases) =>
    canvases.some((canvas) => {
      if (!(canvas instanceof HTMLCanvasElement) || canvas.width === 0 || canvas.height === 0) {
        return false;
      }
      const context = canvas.getContext('2d');
      if (!context) return false;
      const stepX = Math.max(1, Math.floor(canvas.width / 40));
      const stepY = Math.max(1, Math.floor(canvas.height / 40));
      for (let y = 0; y < canvas.height; y += stepY) {
        for (let x = 0; x < canvas.width; x += stepX) {
          const pixel = context.getImageData(x, y, 1, 1).data;
          if ((pixel[3] ?? 0) === 0) continue;
          const distanceFromWhite =
            Math.abs((pixel[0] ?? 255) - 255) +
            Math.abs((pixel[1] ?? 255) - 255) +
            Math.abs((pixel[2] ?? 255) - 255);
          if (distanceFromWhite > 24) return true;
        }
      }
      return false;
    }),
  );
}
