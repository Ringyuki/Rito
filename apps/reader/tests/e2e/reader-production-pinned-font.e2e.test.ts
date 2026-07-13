import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import {
  installPinnedFallbackProbe,
  readPinnedFallbackProbe,
  type PinnedFallbackProbeSnapshot,
} from './pinned-fallback-probe';

const LOAD_TIMEOUT_MS = 90_000;
const TINOS_SHA256 = '60a0e8ef0c04dd5dd69ffe91025fa2ae5836cbd35600a82ba031977557e2cb61';
const SOURCE_HAN_SHA256 = '3754ea669c530e2473354f8f6d9f79680a44d7e26ec7d00eeabee4a7e0753c5d';
const EXPECTED_HASHES = [TINOS_SHA256, SOURCE_HAN_SHA256] as const;
const EXPECTED_BYTE_LENGTHS = [521_588, 11_626_108] as const;
const EXPECTED_ALIASES = EXPECTED_HASHES.map((hash) => `__RitoPinned_${hash}`);
const EXPECTED_SELECTORS = [
  { genericRole: 'serif', language: 'und' },
  { genericRole: 'serif', language: 'zh-hans' },
] as const;
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

    const probe = await waitForPolicyCycles(page, 2);
    expectPolicyRequests(probe, 2);
    expectPolicyResults(probe, 2);
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
    expect((await readPinnedFallbackProbe(page)).openRequests).toHaveLength(0);
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
    expect((await readPinnedFallbackProbe(page)).openRequests).toHaveLength(0);
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
  await expect.poll(() => policyCycleCount(page), { timeout: LOAD_TIMEOUT_MS }).toBe(2);
  await expect(page.getByTestId('reader-shell')).toHaveAttribute('data-loaded', 'true', {
    timeout: LOAD_TIMEOUT_MS,
  });
}

async function forceTargetCanvasPaint(page: Page): Promise<void> {
  const before = await currentSpread(page);
  await page.keyboard.press('ArrowRight');
  await expect.poll(() => currentSpread(page)).toBeGreaterThan(before);
}

async function waitForPolicyCycles(
  page: Page,
  count: number,
): Promise<PinnedFallbackProbeSnapshot> {
  await expect.poll(() => policyCycleCount(page), { timeout: LOAD_TIMEOUT_MS }).toBe(count);
  return readPinnedFallbackProbe(page);
}

async function policyCycleCount(page: Page): Promise<number> {
  return (await readPinnedFallbackProbe(page)).openResults.length;
}

async function currentSpread(page: Page): Promise<number> {
  const value = await page.getByTestId('reader-shell').getAttribute('data-current-spread');
  return Number(value);
}

function expectPolicyRequests(probe: PinnedFallbackProbeSnapshot, count: number): void {
  expect(probe.openRequests).toHaveLength(count);
  for (const request of probe.openRequests) {
    expect(request.expectedSha256).toEqual(EXPECTED_HASHES);
    expect(request.faceBufferByteLengths).toEqual(EXPECTED_BYTE_LENGTHS);
  }
}

function expectPolicyResults(probe: PinnedFallbackProbeSnapshot, count: number): void {
  expect(probe.openResults).toHaveLength(count);
  for (const result of probe.openResults) {
    expect(result.faces.map((face) => face.sha256)).toEqual(EXPECTED_HASHES);
    expect(result.faces.map((face) => face.familyAlias)).toEqual(EXPECTED_ALIASES);
    expect(result.faces.map((face) => face.byteLength)).toEqual(EXPECTED_BYTE_LENGTHS);
    expect(result.faces.map(({ genericRole, language }) => ({ genericRole, language }))).toEqual(
      EXPECTED_SELECTORS,
    );
    expect(result.faces.every((face) => /^[0-9a-f]{16}$/.test(face.shapeFingerprint))).toBe(true);
  }
  expect(probe.openResults[1]?.policyId).toBe(probe.openResults[0]?.policyId);
}

function isPinnedTargetPaint(paint: PinnedFallbackProbeSnapshot['paints'][number]): boolean {
  return paint.targetCanvas && EXPECTED_ALIASES.some((alias) => paint.font.includes(alias));
}
