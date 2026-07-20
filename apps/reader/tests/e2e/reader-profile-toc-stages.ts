import { expect, type Locator, type Page } from '@playwright/test';
import {
  clickReaderTocButtonAcceptedAt,
  startReaderActiveHrefObserver,
  stopReaderActiveHrefObserver,
} from './reader-active-href-observer';
import { readReaderChapterLocalPreviewMode } from './reader-chapter-local-preview-mode';
import {
  readerAttribute,
  readReaderCanvasSample,
  stableReaderCanvasSampleChecksum,
  waitForReaderTransitionEnd,
  type ReaderCanvasSample,
} from './reader-page-harness';
import {
  requireAnimatedReaderTurn,
  startReaderTransitionObserver,
  stopReaderTransitionObserver,
} from './reader-transition-harness';
import {
  calibrateReaderVisualTransitionSampler,
  measureAtomicReaderTurn,
  measureVisualReaderTurn,
  requireAtomicReaderTurn,
  requireVisualReaderTurn,
  startReaderVisualTransitionSampler,
  stopReaderVisualTransitionSampler,
} from './reader-transition-visual-harness';
import type {
  ReaderProfileFarTocStageInput,
  ReaderProfileFarTocTransition,
  ReaderProfileStageInput,
  ReaderProfileTocSupersedeTransitionInput,
} from './reader-profile-model';
import {
  armReaderWorkerResponseHolds,
  captureReaderProbeCursor,
  readHeldReaderWorkerContinuations,
  readReaderWorkerOperations,
  readReaderProbeSlice,
  releaseHeldReaderWorkerContinuations,
  readerWorkerTocResponseHoldPlan,
  waitForHeldReaderWorkerResponses,
  waitForReaderProbeIdle,
  type ReaderProbeSlice,
} from './reader-worker-probe';

const READER_TOC_TIMEOUT_MS = readerTocTimeoutMs(process.env['RITO_READER_TOC_TIMEOUT_MS']);

function readerTocTimeoutMs(value: string | undefined): number {
  if (value === undefined) return 90_000;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1_000 || parsed > 90_000) {
    throw new Error('RITO_READER_TOC_TIMEOUT_MS must be an integer from 1000 to 90000');
  }
  return parsed;
}

export interface TocSupersedeProfileResult {
  readonly checksum: string;
  readonly stage: ReaderProfileStageInput;
  readonly transition: ReaderProfileTocSupersedeTransitionInput;
}

export interface FarTocProfileResult {
  readonly checksum: string;
  readonly stage: ReaderProfileFarTocStageInput;
  readonly transition: ReaderProfileFarTocTransition;
}

export async function runTocSupersedeProfile(
  page: Page,
  previousChecksum: string,
): Promise<TocSupersedeProfileResult> {
  await prepareToc(page);
  const fromHref = await requireActiveChapterHref(page);
  const nearHref = await tocButtonHref(firstTocButton(page));
  const farHref = await tocButtonHref(lastTocButton(page));
  requireDistinctTocHrefs(fromHref, nearHref, farHref);
  await waitForReaderProbeIdle(page);
  await startReaderActiveHrefObserver(page);
  try {
    const chapterLocalPreviewEnabled =
      (await readReaderChapterLocalPreviewMode(page)) === 'enabled';
    const expectedHoldCategories = chapterLocalPreviewEnabled
      ? (['mainContinuation', 'chapterLocalMutation'] as const)
      : (['mainContinuation'] as const);
    await armReaderWorkerResponseHolds(
      page,
      readerWorkerTocResponseHoldPlan(chapterLocalPreviewEnabled),
    );
    const cursor = await captureReaderProbeCursor(page);
    await clickReaderTocButtonAcceptedAt(lastTocButton(page));
    const held = await waitForHeldReaderWorkerResponses(
      page,
      expectedHoldCategories,
      READER_TOC_TIMEOUT_MS,
    );
    const startedAt = await clickReaderTocButtonAcceptedAt(firstTocButton(page), true);
    await releaseHeldReaderWorkerContinuations(page);
    const firstFrame = await waitForTocTargetFrame(page, nearHref, previousChecksum);
    const settled = await settleTocStage(page);
    const slice = await readReaderProbeSlice(page, cursor);
    const releasedHolds = await readHeldReaderWorkerContinuations(page);
    const observedHrefObservations = await stopReaderActiveHrefObserver(page);
    const heldMain = held.find((entry) => entry.category === 'mainContinuation');
    if (!heldMain) throw new Error('Reader TOC supersede stage did not hold main continuation');
    return {
      checksum: settled.checksum,
      stage: stageInput(slice, startedAt, firstFrame.capturedAt, settled.observedUntil),
      transition: {
        fromHref,
        toHref: nearHref,
        supersededHref: farHref,
        checksumBefore: previousChecksum,
        checksumAfter: settled.checksum,
        observedHrefs: observedHrefObservations.map((entry) => entry.href),
        observedHrefObservations,
        supersededAt: startedAt,
        heldContinuationRequestId: heldMain.requestId,
        heldResponses: held.map(({ workerId, category, kind, requestId, heldAt }) => {
          const released = releasedHolds.find(
            (entry) =>
              entry.workerId === workerId &&
              entry.requestId === requestId &&
              entry.kind === kind &&
              entry.category === category,
          );
          if (released?.releasedAt === null || released?.releasedAt === undefined) {
            throw new Error(`Reader worker hold was not released: ${kind}#${String(requestId)}`);
          }
          return {
            workerId,
            category,
            kind,
            requestId,
            heldAt,
            releasedAt: released.releasedAt,
          };
        }),
      },
    };
  } finally {
    await releaseHeldReaderWorkerContinuations(page);
    await stopReaderActiveHrefObserver(page);
  }
}

export async function runFarTocProfile(
  page: Page,
  previousChecksum: string,
): Promise<FarTocProfileResult> {
  await prepareToc(page);
  const fromHref = await requireActiveChapterHref(page);
  const farHref = await tocButtonHref(lastTocButton(page));
  if (farHref === fromHref) throw new Error('Reader is already at the intended far TOC target');
  await waitForReaderProbeIdle(page);
  const previewEnabled = (await readReaderChapterLocalPreviewMode(page)) === 'enabled';
  if (previewEnabled) await startReaderTransitionObserver(page);
  try {
    await startReaderVisualTransitionSampler(page);
    await calibrateReaderVisualTransitionSampler(page);
    const cursor = await captureReaderProbeCursor(page);
    const startedAt = await clickReaderTocButtonAcceptedAt(lastTocButton(page));
    const firstFrame = await waitForTocTargetFrame(page, farHref, previousChecksum);
    const lifecycle = previewEnabled
      ? await requireAnimatedReaderTurn(page, firstFrame.capturedAt)
      : undefined;
    const settled = await settleTocStage(page);
    const slice = await readReaderProbeSlice(page, cursor);
    const visual = await stopReaderVisualTransitionSampler(page);
    if (!visual) throw new Error('Reader far TOC visual transition sample is unavailable');
    const visualMeasurement = lifecycle
      ? measureAnimatedFarToc(visual, lifecycle, startedAt, fromHref, farHref)
      : measureAtomicFarToc(visual, startedAt, fromHref, farHref);
    return {
      checksum: settled.checksum,
      stage: {
        ...stageInput(
          slice,
          startedAt,
          visualMeasurement.firstTargetFrameAt,
          settled.observedUntil,
        ),
        workerRequestsToFirstFrame: slice.operations.filter(
          (operation) =>
            operation.startedAt >= startedAt &&
            operation.startedAt <= visualMeasurement.firstTargetFrameAt,
        ).length,
      },
      transition: {
        fromHref,
        toHref: farHref,
        checksumBefore: previousChecksum,
        checksumAfter: settled.checksum,
        ...farTocPresentation(visualMeasurement, startedAt, settled.observedUntil),
      },
    };
  } finally {
    await stopReaderVisualTransitionSampler(page);
    await stopReaderTransitionObserver(page);
  }
}

type AnimatedFarTocMeasurement = ReturnType<typeof measureVisualReaderTurn> & {
  readonly kind: 'animated';
  readonly startedAt: number;
  readonly endedAt: number;
};

type AtomicFarTocMeasurement = ReturnType<typeof measureAtomicReaderTurn> & {
  readonly kind: 'atomic';
};

type FarTocMeasurement = AnimatedFarTocMeasurement | AtomicFarTocMeasurement;

type FarTocPresentation<Transition = FarTocProfileResult['transition']> =
  Transition extends FarTocProfileResult['transition']
    ? Pick<Transition, 'presentation' | 'latency' | 'animation'>
    : never;

function measureAnimatedFarToc(
  visual: Parameters<typeof requireVisualReaderTurn>[0],
  lifecycle: Parameters<typeof requireVisualReaderTurn>[1],
  startedAt: number,
  fromHref: string,
  farHref: string,
): AnimatedFarTocMeasurement {
  requireVisualReaderTurn(visual, lifecycle, fromHref, farHref);
  return {
    kind: 'animated',
    startedAt: lifecycle.startedAt,
    endedAt: lifecycle.endedAt,
    ...measureVisualReaderTurn(visual, lifecycle, startedAt, farHref),
  };
}

function measureAtomicFarToc(
  visual: Parameters<typeof requireAtomicReaderTurn>[0],
  startedAt: number,
  fromHref: string,
  farHref: string,
): AtomicFarTocMeasurement {
  requireAtomicReaderTurn(visual, fromHref, farHref);
  return { kind: 'atomic', ...measureAtomicReaderTurn(visual, startedAt, farHref) };
}

function farTocPresentation(
  measurement: FarTocMeasurement,
  acceptedAt: number,
  observedUntil: number,
): FarTocPresentation {
  const common = {
    acceptedToFirstVisualChangeMs: rounded(measurement.firstVisualChangeAt - acceptedAt),
    acceptedToFirstTargetFrameMs: rounded(measurement.firstTargetFrameAt - acceptedAt),
    acceptedToStableIdleObservationMs: rounded(observedUntil - acceptedAt),
  };
  if (measurement.kind === 'atomic') {
    return {
      presentation: 'atomic',
      latency: {
        ...common,
        acceptedToTransitionStartMs: null,
        firstTargetFrameRelativeToTransitionEndMs: null,
        acceptedToTransitionEndMs: null,
      },
      animation: null,
    };
  }
  return {
    presentation: 'animated',
    latency: {
      ...common,
      acceptedToTransitionStartMs: rounded(measurement.startedAt - acceptedAt),
      firstTargetFrameRelativeToTransitionEndMs: rounded(
        measurement.firstTargetFrameAt - measurement.endedAt,
      ),
      acceptedToTransitionEndMs: rounded(measurement.endedAt - acceptedAt),
    },
    animation: measurement.animation,
  };
}

function rounded(value: number): number {
  return Math.round(value * 1000) / 1000;
}

async function prepareToc(page: Page): Promise<void> {
  await waitForReaderTransitionEnd(page);
  const heading = page.getByRole('heading', { name: 'Contents' });
  if (!(await heading.isVisible())) {
    await page.getByTestId('reader-context-trigger').click({ button: 'right' });
    await page.getByRole('menuitem', { name: /Contents/ }).click();
    await expect(heading).toBeVisible();
  }
  await expect
    .poll(() => tocButtons(page).count(), { timeout: READER_TOC_TIMEOUT_MS })
    .toBeGreaterThan(1);
}

function tocButtons(page: Page): Locator {
  return page.getByRole('dialog').locator('nav button');
}

function firstTocButton(page: Page): Locator {
  return tocButtons(page).first();
}

function lastTocButton(page: Page): Locator {
  return tocButtons(page).last();
}

async function tocButtonHref(button: Locator): Promise<string> {
  const href = await button.getAttribute('data-toc-href');
  if (href === null || href === '') throw new Error('TOC entry has no intended href');
  return href;
}

function requireDistinctTocHrefs(fromHref: string, nearHref: string, farHref: string): void {
  if (nearHref === farHref) throw new Error('Reader TOC profile requires distinct near/far hrefs');
  if (nearHref === fromHref) throw new Error('Reader is already at the intended near TOC target');
  if (farHref === fromHref) throw new Error('Reader is already at the intended far TOC target');
}

async function waitForTocTargetFrame(
  page: Page,
  expectedHref: string,
  previousChecksum: string,
): Promise<ReaderCanvasSample> {
  const deadline = Date.now() + READER_TOC_TIMEOUT_MS;
  let lastSample: ReaderCanvasSample | null = null;
  while (Date.now() < deadline) {
    const sample = await readReaderCanvasSample(page);
    lastSample = sample;
    if (
      sample?.nonBlank === true &&
      sample.activeChapterHref === expectedHref &&
      sample.checksum !== previousChecksum
    ) {
      return sample;
    }
    await page.waitForTimeout(2);
  }
  const shell = {
    currentSpread: await readerAttribute(page, 'data-current-spread'),
    transitioning: await readerAttribute(page, 'data-transitioning'),
    activeChapterHref: await readerAttribute(page, 'data-active-chapter-href'),
  };
  const operations = (await readReaderWorkerOperations(page)).slice(-40).map((operation) => ({
    workerId: operation.workerId,
    requestId: operation.requestId,
    kind: operation.kind,
    maxQuanta: operation.maxQuanta,
    advancedQuanta: operation.advancedQuanta,
    requestedRevision: operation.requestedRevision,
    revision: operation.revision,
    ok: operation.ok,
    error: operation.error,
  }));
  const heldResponses = (await readHeldReaderWorkerContinuations(page)).slice(-8);
  throw new Error(
    `Reader TOC target never painted: ${JSON.stringify({ expectedHref, previousChecksum, lastSample, shell, operations, heldResponses })}`,
  );
}

async function settleTocStage(page: Page): Promise<{
  readonly checksum: string;
  readonly observedUntil: number;
}> {
  await waitForReaderTransitionEnd(page);
  const checksum = await stableReaderCanvasSampleChecksum(page);
  await waitForReaderProbeIdle(page);
  return { checksum, observedUntil: await page.evaluate(() => performance.now()) };
}

function stageInput(
  slice: ReaderProbeSlice,
  startedAt: number,
  completedAt: number,
  observedUntil: number,
): ReaderProfileStageInput {
  return {
    startedAt,
    completedAt,
    observedUntil,
    operations: slice.operations,
    longTasks: slice.longTasks.filter(
      (task) => task.startTime <= observedUntil && task.startTime + task.duration >= startedAt,
    ),
  };
}

async function requireActiveChapterHref(page: Page): Promise<string> {
  const href = await readerAttribute(page, 'data-active-chapter-href');
  if (href === '') throw new Error('Reader has no active chapter before TOC profiling');
  return href;
}
