import { expect, type Page, type Worker } from '@playwright/test';
import type {
  ReaderProfileFreshFarGeneration,
  ReaderProfileViewport,
} from './reader-profile-model';
import { runInitialProfile, type InitialProfileResult } from './reader-profile-stages';
import {
  captureReaderProbeCursor,
  readReaderWorkerOperations,
  type ReaderWorkerOperationObservation,
} from './reader-worker-probe';
import { waitForReaderStartup } from './reader-startup-probe';

const READER_POSITION_STORAGE_KEY = 'rito-position';
const WORKER_CLOSE_TIMEOUT_MS = 30_000;

export interface FreshFarBootstrapResult extends InitialProfileResult {
  readonly generation: ReaderProfileFreshFarGeneration;
}

export async function runFreshFarBootstrap(
  page: Page,
  epubPath: string,
  viewport: ReaderProfileViewport,
  previousOperations: readonly ReaderWorkerOperationObservation[],
): Promise<FreshFarBootstrapResult> {
  const previousWorkers = requireWorkerCount(page.workers(), 1, 'previous reader page');
  const workerClosures = previousWorkers.map((worker) => waitForWorkerClose(worker));
  await clearPositionOnReload(page);
  await page.reload();
  const closedWorkers = await Promise.all(workerClosures);
  await waitForReaderStartup(page);
  const positionClearedBeforeOpen = await requireClearedPosition(page);
  await page.setViewportSize(viewport);
  await expect(page.getByTestId('reader-empty')).toBeVisible();
  const workersBeforeOpen = page.workers().length;
  if (workersBeforeOpen !== 0) {
    throw new Error('Fresh far-TOC page retained a worker before reopening the EPUB');
  }
  const freshCursor = await captureReaderProbeCursor(page);
  if (freshCursor.operationIndex !== 0) {
    throw new Error('Fresh far-TOC probe observed operations before reopening the EPUB');
  }
  const initial = await runInitialProfile(page, epubPath);
  const freshWorkers = requireWorkerCount(page.workers(), 1, 'fresh reader page');
  const freshOperations = await readReaderWorkerOperations(page);
  const freshOpen = requireSuccessfulOperation(freshOperations, 'open');
  const freshRevision = requireSuccessfulOperation(freshOperations, 'createBoundedRevision');
  if (
    freshOpen.workerId !== freshRevision.workerId ||
    freshOpen.completedAt === null ||
    freshOpen.completedAt > freshRevision.startedAt
  ) {
    throw new Error('Fresh far-TOC bootstrap did not open before creating its revision');
  }
  const previousRevisionIds = revisionIds(previousOperations);
  const freshRevisionIds = revisionIds(freshOperations);
  requireObservedRevisions(previousRevisionIds, freshRevisionIds);
  return {
    ...initial,
    generation: {
      previousRevisionIds,
      freshRevisionIds,
      previousWorkerCount: previousWorkers.length,
      closedWorkerCount: closedWorkers.length,
      workersBeforeOpen,
      freshWorkerCount: freshWorkers.length,
      positionStorageKey: READER_POSITION_STORAGE_KEY,
      positionClearedBeforeOpen,
      freshProbeOperationIndex: freshCursor.operationIndex,
      freshOpenRequestId: freshOpen.requestId,
      freshRevisionRequestId: freshRevision.requestId,
      checksumAfter: initial.checksum,
    },
  };
}

async function clearPositionOnReload(page: Page): Promise<void> {
  await page.addInitScript((key) => {
    localStorage.removeItem(key);
  }, READER_POSITION_STORAGE_KEY);
  await page.evaluate((key) => {
    localStorage.removeItem(key);
  }, READER_POSITION_STORAGE_KEY);
}

async function requireClearedPosition(page: Page): Promise<true> {
  const stored = await page.evaluate(
    (key) => localStorage.getItem(key),
    READER_POSITION_STORAGE_KEY,
  );
  if (stored !== null) throw new Error('Fresh far-TOC page restored a persisted reader position');
  return true;
}

function waitForWorkerClose(worker: Worker): Promise<Worker> {
  return worker.waitForEvent('close', { timeout: WORKER_CLOSE_TIMEOUT_MS });
}

function requireWorkerCount(workers: readonly Worker[], count: number, label: string): Worker[] {
  if (workers.length !== count) {
    throw new Error(
      `${label} expected ${String(count)} worker, received ${String(workers.length)}`,
    );
  }
  return [...workers];
}

function revisionIds(operations: readonly ReaderWorkerOperationObservation[]): string[] {
  return [
    ...new Set(
      operations.flatMap((operation) =>
        operation.revision?.revisionId ? [operation.revision.revisionId] : [],
      ),
    ),
  ];
}

function requireObservedRevisions(previous: readonly string[], fresh: readonly string[]): void {
  if (previous.length === 0 || fresh.length === 0) {
    throw new Error('Fresh far-TOC bootstrap did not observe both revision generations');
  }
}

function requireSuccessfulOperation(
  operations: readonly ReaderWorkerOperationObservation[],
  kind: string,
): ReaderWorkerOperationObservation {
  const operation = operations.find((entry) => entry.kind === kind && entry.ok === true);
  if (!operation) throw new Error(`Fresh far-TOC bootstrap did not complete ${kind}`);
  return operation;
}
