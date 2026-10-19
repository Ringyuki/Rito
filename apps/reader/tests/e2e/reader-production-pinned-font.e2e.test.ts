import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import {
  installPinnedFallbackProbe,
  readPinnedFallbackProbe,
  type PinnedFallbackProbeSnapshot,
} from './pinned-fallback-probe';
import {
  PRODUCTION_PINNED_FONT_ALIASES as EXPECTED_ALIASES,
  PRODUCTION_PINNED_FONT_HASHES as EXPECTED_HASHES,
} from './reader-production-pinned-font-contract';
import { pinnedFaceOpens, readReaderSessionLog } from './reader-session-log';

const LOAD_TIMEOUT_MS = 90_000;
const TINOS_FILE_URL = new URL('../../src/assets/fonts/Tinos-Regular.ttf', import.meta.url);

test.describe('reader app production pinned fallback', () => {
  test('reuses both source buffers across real app loads and paints a pinned alias', async ({
    page,
  }) => {
    await installPinnedFallbackProbe(page);
    const releaseFont = await holdTinosBootstrap(page);
    await page.goto('/');
    await expect(page.getByTestId('reader-startup-loading')).toBeVisible();
    releaseFont();
    await loadDemo(page);
    await forceTargetCanvasPaint(page);
    await reloadDemo(page);
    await forceTargetCanvasPaint(page);

    // Every load opens a session with the same faces, still whole: the
    // engine refuses a face whose bytes do not hash to its SHA-256, so the
    // invariant is the policy of EVERY open, and that every open succeeded.
    await waitForPolicyCycles(page, 2);
    const opens = pinnedFaceOpens(await readReaderSessionLog(page));
    expect(opens.length).toBeGreaterThanOrEqual(2);
    for (const open of opens) {
      expect(open.sha256).toEqual(EXPECTED_HASHES);
      expect(open.ok).toBe(true);
    }
    const probe = await readPinnedFallbackProbe(page);
    expect(probe.paints.some(isPinnedTargetPaint)).toBe(true);
  });

  test('fails closed before mounting App when a required font asset cannot load', async ({
    page,
  }) => {
    await installPinnedFallbackProbe(page);
    await page.route('**/Tinos-Regular*.ttf', async (route) => {
      await route.abort('failed');
    });
    await page.goto('/');

    const error = page.getByTestId('reader-startup-error');
    await expect(error).toBeVisible();
    await expect(error).toContainText('Tinos-Regular.ttf');
    await expect(page.getByTestId('reader-shell')).toHaveCount(0);
    expect(pinnedFaceOpens(await readReaderSessionLog(page))).toHaveLength(0);
  });

  test('rejects same-length font corruption before mounting App', async ({ page }) => {
    const corrupted = Buffer.from(await readFile(TINOS_FILE_URL));
    corrupted[0] = (corrupted[0] ?? 0) ^ 0xff;
    await installPinnedFallbackProbe(page);
    await page.route('**/Tinos-Regular*.ttf', async (route) => {
      await route.fulfill({ body: corrupted, contentType: 'font/ttf' });
    });
    await page.goto('/');

    const error = page.getByTestId('reader-startup-error');
    await expect(error).toContainText('SHA-256 mismatch');
    await expect(page.getByTestId('reader-shell')).toHaveCount(0);
    expect(pinnedFaceOpens(await readReaderSessionLog(page))).toHaveLength(0);
  });
});

async function holdTinosBootstrap(page: Page): Promise<() => void> {
  let release = (): void => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/Tinos-Regular*.ttf', async (route) => {
    await gate;
    await route.continue();
  });
  return release;
}

async function loadDemo(page: Page): Promise<void> {
  await expect(page.getByTestId('reader-empty')).toBeVisible({ timeout: LOAD_TIMEOUT_MS });
  await page.getByTestId('load-demo-button').click();
  await expect(page.getByTestId('reader-shell')).toHaveAttribute('data-loaded', 'true', {
    timeout: LOAD_TIMEOUT_MS,
  });
}

async function reloadDemo(page: Page): Promise<void> {
  await page.getByTestId('reader-context-trigger').click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Load Demo' }).click();
  await expect
    .poll(() => policyCycleCount(page), { timeout: LOAD_TIMEOUT_MS })
    .toBeGreaterThanOrEqual(2);
  await expect(page.getByTestId('reader-shell')).toHaveAttribute('data-loaded', 'true', {
    timeout: LOAD_TIMEOUT_MS,
  });
}

async function forceTargetCanvasPaint(page: Page): Promise<void> {
  const before = await currentSpread(page);
  await page.keyboard.press('ArrowRight');
  await expect.poll(() => currentSpread(page)).toBeGreaterThan(before);
}

async function waitForPolicyCycles(page: Page, count: number): Promise<void> {
  await expect
    .poll(() => policyCycleCount(page), { timeout: LOAD_TIMEOUT_MS })
    .toBeGreaterThanOrEqual(count);
}

/** Sessions the page has opened. */
async function policyCycleCount(page: Page): Promise<number> {
  return pinnedFaceOpens(await readReaderSessionLog(page)).filter((open) => open.ok === true)
    .length;
}

async function currentSpread(page: Page): Promise<number> {
  const value = await page.getByTestId('reader-shell').getAttribute('data-current-spread');
  return Number(value);
}

function isPinnedTargetPaint(paint: PinnedFallbackProbeSnapshot['paints'][number]): boolean {
  return paint.targetCanvas && EXPECTED_ALIASES.some((alias) => paint.font.includes(alias));
}
