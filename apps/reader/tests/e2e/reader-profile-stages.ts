import { expect, type Page } from '@playwright/test';
import {
  currentSpread,
  hasNonBlankCanvas,
  readerAttribute,
  readerCanvasSampleChecksum,
  readerNumberAttribute,
  resetToFirstSpread,
  stableReaderCanvasSampleChecksum,
  waitForReaderSpreadPaint,
  waitForReaderTransitionEnd,
} from './reader-page-harness';
import type {
  ReaderProfileStageInput,
  ReaderProfileTransition,
  ReaderProfileViewport,
} from './reader-profile-model';
import { requireIncompleteRevision } from './reader-profile-protocol';
import {
  captureReaderProbeCursor,
  readReaderProbeSlice,
  readReaderWorkerOperations,
  waitForReaderProbeIdle,
  type ReaderProbeCursor,
  type ReaderProbeSlice,
  type ReaderWorkerOperationObservation,
} from './reader-worker-probe';

const READER_LOAD_TIMEOUT_MS = 90_000;

export interface InitialProfileResult {
  readonly startedAt: number;
  readonly loadedAt: number;
  readonly canvasAt: number;
  readonly checksum: string;
  readonly stage: ReaderProfileStageInput;
}

export interface TransitionProfileResult {
  readonly checksum: string;
  readonly stage: ReaderProfileStageInput;
  readonly transition: ReaderProfileTransition;
}

export async function runInitialProfile(
  page: Page,
  epubPath: string,
): Promise<InitialProfileResult> {
  const cursor = await captureReaderProbeCursor(page);
  await page.locator('input[type="file"][accept=".epub"]').first().setInputFiles(epubPath);
  await expect
    .poll(() => readerAttribute(page, 'data-loaded'), {
      timeout: READER_LOAD_TIMEOUT_MS,
      intervals: [10],
    })
    .toBe('true');
  const loadedAt = await pageNow(page);
  await expect
    .poll(() => readerNumberAttribute(page, 'data-total-spreads'), { intervals: [10] })
    .toBeGreaterThan(0);
  await expect
    .poll(() => hasNonBlankCanvas(page), {
      timeout: READER_LOAD_TIMEOUT_MS,
      intervals: [10],
    })
    .toBe(true);
  await readerCanvasSampleChecksum(page);
  const canvasAt = await pageNow(page);
  const checksum = await stableReaderCanvasSampleChecksum(page);
  const observedUntil = await pageNow(page);
  const slice = await finishProbeSlice(page, cursor);
  return {
    startedAt: cursor.capturedAt,
    loadedAt,
    canvasAt,
    checksum,
    stage: stageInput(slice, canvasAt, observedUntil),
  };
}

export async function runCachedTurnProfile(
  page: Page,
  initialChecksum: string,
): Promise<TransitionProfileResult> {
  const warmChecksum = await warmSecondSpread(page, initialChecksum);
  await resetToFirstSpread(page);
  await waitForReaderSpreadPaint(page, 0, warmChecksum);
  const checksumBefore = await stableReaderCanvasSampleChecksum(page);
  await waitForReaderProbeIdle(page);
  const knownSpreadCount = await readerNumberAttribute(page, 'data-total-spreads');
  const cursor = await captureReaderProbeCursor(page);
  await page.keyboard.press('ArrowRight');
  await waitForReaderSpreadPaint(page, 1, checksumBefore);
  const paintedAt = await pageNow(page);
  await waitForReaderTransitionEnd(page);
  const checksumAfter = await readerCanvasSampleChecksum(page);
  const observedUntil = await pageNow(page);
  const slice = await finishProbeSlice(page, cursor);
  return transitionResult(checksumAfter, slice, paintedAt, observedUntil, {
    fromSpread: 0,
    toSpread: 1,
    knownSpreadCountBefore: knownSpreadCount,
    knownSpreadCountAfter: await readerNumberAttribute(page, 'data-total-spreads'),
    checksumBefore,
    checksumAfter,
  });
}

export async function runDeferredGrowthProfile(
  page: Page,
  previousChecksum: string,
): Promise<TransitionProfileResult> {
  const knownSpreadCount = await readerNumberAttribute(page, 'data-total-spreads');
  const knownLastSpread = knownSpreadCount - 1;
  const checksumBefore = await moveToKnownRevisionEnd(page, knownLastSpread, previousChecksum);
  requireIncompleteRevision(await readReaderWorkerOperations(page));
  const cursor = await captureReaderProbeCursor(page);
  await page.keyboard.press('ArrowRight');
  await waitForExtentGrowth(page, knownSpreadCount, knownLastSpread);
  const targetSpread = await currentSpread(page);
  await waitForReaderSpreadPaint(page, targetSpread, checksumBefore);
  const paintedAt = await pageNow(page);
  const checksumAfter = await stableReaderCanvasSampleChecksum(page);
  const observedUntil = await pageNow(page);
  const slice = await finishProbeSlice(page, cursor);
  return transitionResult(checksumAfter, slice, paintedAt, observedUntil, {
    fromSpread: knownLastSpread,
    toSpread: targetSpread,
    knownSpreadCountBefore: knownSpreadCount,
    knownSpreadCountAfter: await readerNumberAttribute(page, 'data-total-spreads'),
    checksumBefore,
    checksumAfter,
  });
}

export async function runReflowProfile(
  page: Page,
  viewport: ReaderProfileViewport,
  previousChecksum: string,
): Promise<ReaderProfileStageInput> {
  const cursor = await captureReaderProbeCursor(page);
  await page.setViewportSize(viewport);
  await expect
    .poll(async () => reflowSnapshotReady((await readReaderProbeSlice(page, cursor)).operations), {
      timeout: READER_LOAD_TIMEOUT_MS,
      intervals: [10],
    })
    .toBe(true);
  const spreadIndex = await requireValidCurrentSpread(page);
  await waitForReaderSpreadPaint(page, spreadIndex, previousChecksum);
  const paintedAt = await pageNow(page);
  await stableReaderCanvasSampleChecksum(page);
  const observedUntil = await pageNow(page);
  return stageInput(await finishProbeSlice(page, cursor), paintedAt, observedUntil);
}

async function warmSecondSpread(page: Page, previousChecksum: string): Promise<string> {
  const knownSpreadCount = await readerNumberAttribute(page, 'data-total-spreads');
  await page.keyboard.press('ArrowRight');
  if (knownSpreadCount < 2) {
    await expect
      .poll(() => readerNumberAttribute(page, 'data-total-spreads'), {
        timeout: READER_LOAD_TIMEOUT_MS,
        intervals: [10],
      })
      .toBeGreaterThan(knownSpreadCount);
  }
  await waitForReaderSpreadPaint(page, 1, previousChecksum);
  const checksum = await stableReaderCanvasSampleChecksum(page);
  await waitForReaderProbeIdle(page);
  return checksum;
}

async function moveToKnownRevisionEnd(
  page: Page,
  knownLastSpread: number,
  previousChecksum: string,
): Promise<string> {
  await page.keyboard.press('End');
  await waitForReaderSpreadPaint(
    page,
    knownLastSpread,
    knownLastSpread === 1 ? undefined : previousChecksum,
  );
  const checksum = await stableReaderCanvasSampleChecksum(page);
  await waitForReaderProbeIdle(page);
  return checksum;
}

async function waitForExtentGrowth(
  page: Page,
  knownSpreadCount: number,
  knownLastSpread: number,
): Promise<void> {
  await expect
    .poll(() => readerNumberAttribute(page, 'data-total-spreads'), {
      timeout: READER_LOAD_TIMEOUT_MS,
      intervals: [10],
    })
    .toBeGreaterThan(knownSpreadCount);
  await expect
    .poll(() => currentSpread(page), { timeout: READER_LOAD_TIMEOUT_MS, intervals: [10] })
    .toBeGreaterThan(knownLastSpread);
}

function transitionResult(
  checksum: string,
  slice: ReaderProbeSlice,
  paintedAt: number,
  observedUntil: number,
  transition: ReaderProfileTransition,
): TransitionProfileResult {
  return { checksum, stage: stageInput(slice, paintedAt, observedUntil), transition };
}

async function finishProbeSlice(page: Page, cursor: ReaderProbeCursor): Promise<ReaderProbeSlice> {
  await waitForReaderProbeIdle(page);
  return readReaderProbeSlice(page, cursor);
}

function stageInput(
  slice: ReaderProbeSlice,
  paintedAt: number,
  observedUntil: number,
): ReaderProfileStageInput {
  return {
    startedAt: slice.startedAt,
    completedAt: paintedAt,
    observedUntil,
    operations: slice.operations,
    longTasks: slice.longTasks.filter(
      (entry) =>
        entry.startTime <= observedUntil && entry.startTime + entry.duration >= slice.startedAt,
    ),
  };
}

async function requireValidCurrentSpread(page: Page): Promise<number> {
  const spreadIndex = await currentSpread(page);
  const spreadCount = await readerNumberAttribute(page, 'data-total-spreads');
  if (!Number.isInteger(spreadIndex) || spreadIndex < 0 || spreadIndex >= spreadCount) {
    throw new Error(
      `Reader reflow committed invalid active spread ${String(spreadIndex)} of ${String(spreadCount)}`,
    );
  }
  return spreadIndex;
}

function reflowSnapshotReady(operations: readonly ReaderWorkerOperationObservation[]): boolean {
  return [
    'open',
    'createBoundedRevision',
    'getRevisionPresentationAtRevision',
    'warmFrameWindowAtRevision',
  ].every((kind) => operations.some((entry) => entry.kind === kind && entry.ok === true));
}

function pageNow(page: Page): Promise<number> {
  return page.evaluate(() => performance.now());
}
