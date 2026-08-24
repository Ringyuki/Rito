import { expect, type Browser, type Page } from '@playwright/test';
import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { arch, cpus, platform, release } from 'node:os';
import {
  currentSpread,
  hasNonBlankCanvas,
  readerAttribute,
  readerNumberAttribute,
  stableReaderCanvasSampleChecksum,
  waitForReaderSpreadPaint,
} from './reader-page-harness';
import { READER_TEST_SERVER_BASE_URL } from './reader-test-server';
import { installReaderStartupProbe, waitForReaderStartup } from './reader-startup-probe';
import { installReaderWorkerProbe, waitForReaderProbeIdle } from './reader-worker-probe';
import type {
  ReaderMemoryCheckpoint,
  ReaderMemoryEnvironment,
  ReaderMemoryGate,
  ReaderMemoryGateReport,
  ReaderMemoryViewport,
} from './memory-gate-types';
import { buildReaderMemoryGateReport } from './memory-gate-report';
import { captureStableReaderMemory, type ReaderMemorySampler } from './memory-sampler';
import {
  observedLiveReaderWorkerIds,
  readerHasIncompleteRevision,
  readerSuccessfulOpenCount,
  requireCurrentReaderOpenSession,
  requireExactlyOneLiveReaderWorker,
  requireFinalReaderWorkerLifecycle,
  requireReaderSessionReleased,
} from './memory-worker-lifecycle';

const LOAD_TIMEOUT_MS = 90_000;

export async function runReaderMemoryGateSample(
  browser: Browser,
  gate: ReaderMemoryGate,
  machineId: string,
): Promise<ReaderMemoryGateReport> {
  const context = await browser.newContext({
    baseURL: READER_TEST_SERVER_BASE_URL,
    viewport: gate.viewport,
    deviceScaleFactor: gate.deviceScaleFactor,
    locale: gate.browser.locale,
    colorScheme: gate.browser.colorScheme,
  });
  const browserSession = await browser.newBrowserCDPSession();
  try {
    await installReaderWorkerProbe(context);
    const page = await context.newPage();
    await installReaderStartupProbe(page);
    const pageSession = await context.newCDPSession(page);
    const sampler: ReaderMemorySampler = {
      page,
      browserSession,
      pageSession,
      policy: gate.scenario.stabilization,
    };
    try {
      return await runScenario(page, browser, gate, machineId, sampler);
    } finally {
      await pageSession.detach();
    }
  } finally {
    await browserSession.detach();
    await context.close();
  }
}

async function runScenario(
  page: Page,
  browser: Browser,
  gate: ReaderMemoryGate,
  machineId: string,
  sampler: ReaderMemorySampler,
): Promise<ReaderMemoryGateReport> {
  await prepareReader(page);
  const initialPageEnvironment = await observePageEnvironment(page);
  const baseline = await captureStableReaderMemory(sampler, 'app-ready');
  await loadFixture(page, gate.fixture.epub);
  const loaded = await captureStableReaderMemory(sampler, 'loaded');
  await growBoundedRevision(page);
  const growth = await captureStableReaderMemory(sampler, 'growth');
  await reflowReader(page, gate.reflowViewport);
  const reflowPageEnvironment = await observePageEnvironment(page);
  const reflow = await captureStableReaderMemory(sampler, 'reflow');
  const replacements = await replaceReaderRounds(page, sampler, gate);
  await disposeThroughInvalidFile(page);
  const disposed = await captureStableReaderMemory(sampler, 'disposed');
  const workerLifecycle = await requireFinalReaderWorkerLifecycle(page);
  return buildReaderMemoryGateReport({
    generatedAt: new Date().toISOString(),
    environment: memoryEnvironment(
      browser,
      machineId,
      initialPageEnvironment,
      reflowPageEnvironment.viewport,
    ),
    browser: {
      ...gate.browser,
      locale: initialPageEnvironment.locale,
      colorScheme: initialPageEnvironment.colorScheme,
    },
    fixture: fixtureReport(gate),
    scenario: gate.scenario,
    checkpoints: { baseline, loaded, growth, reflow, replacements, disposed },
    workerLifecycle,
  });
}

async function prepareReader(page: Page): Promise<void> {
  await page.goto('/');
  await waitForReaderStartup(page);
  await expect(page.getByTestId('reader-empty')).toBeVisible({ timeout: LOAD_TIMEOUT_MS });
  await expect.poll(() => observedLiveReaderWorkerIds(page)).toEqual([]);
}

async function loadFixture(page: Page, epubPath: string): Promise<void> {
  const openCount = await readerSuccessfulOpenCount(page);
  await fileInput(page).setInputFiles(epubPath);
  await waitForSuccessfulOpenAfter(page, openCount);
  await waitForLoadedCanvas(page);
  await waitForReaderProbeIdle(page);
  await requireExactlyOneLiveReaderWorker(page);
}

async function growBoundedRevision(page: Page): Promise<void> {
  await expect.poll(() => readerHasIncompleteRevision(page)).toBe(true);
  const knownSpreadCount = await readerNumberAttribute(page, 'data-total-spreads');
  const knownLastSpread = knownSpreadCount - 1;
  await page.keyboard.press('End');
  await expect.poll(() => currentSpread(page)).toBe(knownLastSpread);
  const checksum = await stableReaderCanvasSampleChecksum(page);
  await page.keyboard.press('ArrowRight');
  await expect
    .poll(() => readerNumberAttribute(page, 'data-total-spreads'), { timeout: LOAD_TIMEOUT_MS })
    .toBeGreaterThan(knownSpreadCount);
  await expect
    .poll(() => currentSpread(page), { timeout: LOAD_TIMEOUT_MS })
    .toBeGreaterThan(knownLastSpread);
  await waitForReaderSpreadPaint(page, await currentSpread(page), checksum);
  await waitForReaderProbeIdle(page);
}

async function reflowReader(
  page: Page,
  viewport: { readonly width: number; readonly height: number },
): Promise<void> {
  const previousSession = await requireCurrentReaderOpenSession(page);
  const openCount = await readerSuccessfulOpenCount(page);
  await page.setViewportSize(viewport);
  await waitForSuccessfulOpenAfter(page, openCount);
  await waitForLoadedCanvas(page);
  await waitForReaderProbeIdle(page);
  await requireExactlyOneLiveReaderWorker(page);
  const activeSession = await requireCurrentReaderOpenSession(page);
  expect(activeSession.openOrdinal).toBeGreaterThan(previousSession.openOrdinal);
  await requireReaderSessionReleased(page, previousSession);
}

async function replaceReaderRounds(
  page: Page,
  sampler: ReaderMemorySampler,
  gate: ReaderMemoryGate,
): Promise<ReaderMemoryCheckpoint[]> {
  const checkpoints: ReaderMemoryCheckpoint[] = [];
  for (let round = 1; round <= gate.scenario.replacementRounds; round += 1) {
    const previousSession = await requireCurrentReaderOpenSession(page);
    const openCount = await readerSuccessfulOpenCount(page);
    await fileInput(page).setInputFiles(gate.fixture.epub);
    await waitForSuccessfulOpenAfter(page, openCount);
    await waitForLoadedCanvas(page);
    await waitForReaderProbeIdle(page);
    await requireExactlyOneLiveReaderWorker(page);
    const activeSession = await requireCurrentReaderOpenSession(page);
    expect(activeSession.openOrdinal).toBeGreaterThan(previousSession.openOrdinal);
    await requireReaderSessionReleased(page, previousSession);
    checkpoints.push(await captureStableReaderMemory(sampler, `replacement-${String(round)}`));
  }
  return checkpoints;
}

async function disposeThroughInvalidFile(page: Page): Promise<void> {
  const previousSession = await requireCurrentReaderOpenSession(page);
  await fileInput(page).setInputFiles({
    name: 'invalid-memory-dispose.epub',
    mimeType: 'application/epub+zip',
    buffer: Buffer.from('not an epub archive'),
  });
  await expect(page.getByTestId('reader-error')).toBeVisible({ timeout: LOAD_TIMEOUT_MS });
  await expect.poll(() => readerAttribute(page, 'data-loaded')).toBe('false');
  await expect.poll(() => readerAttribute(page, 'data-loading')).toBe('false');
  await waitForReaderProbeIdle(page);
  await requireReaderSessionReleased(page, previousSession);
  await expect
    .poll(() => observedLiveReaderWorkerIds(page), { timeout: LOAD_TIMEOUT_MS })
    .toEqual([]);
}

async function waitForLoadedCanvas(page: Page): Promise<void> {
  await expect
    .poll(() => readerAttribute(page, 'data-loaded'), { timeout: LOAD_TIMEOUT_MS })
    .toBe('true');
  await expect
    .poll(() => readerNumberAttribute(page, 'data-total-spreads'), { timeout: LOAD_TIMEOUT_MS })
    .toBeGreaterThan(0);
  await expect.poll(() => hasNonBlankCanvas(page), { timeout: LOAD_TIMEOUT_MS }).toBe(true);
  await stableReaderCanvasSampleChecksum(page);
}

async function waitForSuccessfulOpenAfter(page: Page, previousCount: number): Promise<void> {
  await expect
    .poll(() => readerSuccessfulOpenCount(page), { timeout: LOAD_TIMEOUT_MS })
    .toBeGreaterThan(previousCount);
}

function fileInput(page: Page) {
  return page.locator('input[type="file"][accept=".epub"]').first();
}

interface ReaderPageEnvironmentObservation {
  readonly viewport: ReaderMemoryViewport;
  readonly deviceScaleFactor: number;
  readonly locale: string;
  readonly colorScheme: 'light' | 'dark';
}

function memoryEnvironment(
  browser: Browser,
  machineId: string,
  pageEnvironment: ReaderPageEnvironmentObservation,
  reflowViewport: ReaderMemoryViewport,
): ReaderMemoryEnvironment {
  return {
    machineId,
    platform: platform(),
    arch: arch(),
    cpuModel: cpus()[0]?.model ?? 'unknown',
    osRelease: release(),
    browserName: browser.browserType().name(),
    browserVersion: browser.version(),
    deviceScaleFactor: pageEnvironment.deviceScaleFactor,
    locale: pageEnvironment.locale,
    colorScheme: pageEnvironment.colorScheme,
    viewport: pageEnvironment.viewport,
    reflowViewport,
  };
}

async function observePageEnvironment(page: Page): Promise<ReaderPageEnvironmentObservation> {
  return page.evaluate(() => ({
    viewport: { width: innerWidth, height: innerHeight },
    deviceScaleFactor: devicePixelRatio,
    locale: navigator.language,
    colorScheme: matchMedia('(prefers-color-scheme: dark)').matches
      ? ('dark' as const)
      : ('light' as const),
  }));
}

function fixtureReport(gate: ReaderMemoryGate) {
  const bytes = readFileSync(gate.fixture.epub);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  if (sha256 !== gate.fixture.sha256) {
    throw new Error(
      `Reader memory fixture SHA-256 mismatch: expected ${gate.fixture.sha256}, received ${sha256}`,
    );
  }
  return {
    id: gate.fixture.id,
    path: gate.fixture.epub,
    byteLength: statSync(gate.fixture.epub).size,
    sha256,
  };
}
