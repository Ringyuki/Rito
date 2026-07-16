import { expect, test, type Page } from '@playwright/test';
import { currentSpread, hasNonBlankCanvas, readerNumberAttribute } from './reader-page-harness';
import {
  holdNextReaderWorkerContinuation,
  installReaderWorkerProbe,
  readReaderWorkerCreations,
  readReaderWorkerOperations,
  readReaderWorkerTerminations,
  releaseHeldReaderWorkerContinuations,
  waitForHeldReaderWorkerContinuation,
  waitForReaderProbeIdle,
  type ReaderWorkerOperationObservation,
} from './reader-worker-probe';
import {
  assertReleaseProtocol,
  findReplacementOpen,
  findSessionDispose,
  liveWorkerIds,
} from './reader-release-protocol-assertions';

const LOAD_TIMEOUT_MS = 90_000;

test.describe('reader production release protocol', () => {
  test('drains a pending bounded response before recycling or terminating its worker', async ({
    page,
  }) => {
    await installReaderWorkerProbe(page);
    await page.goto('/');
    await page.evaluate(() => {
      localStorage.clear();
    });
    await page.reload();
    await loadDemo(page);

    const oldOpen = await currentReaderOpen(page);
    await moveToPartialExtentBoundary(page);
    await waitForReaderProbeIdle(page);
    await holdNextReaderWorkerContinuation(page);
    await requestNextSpread(page);
    const held = await waitForHeldReaderWorkerContinuation(page, LOAD_TIMEOUT_MS);
    expect(held.workerId).toBe(oldOpen.workerId);

    await reloadDemo(page);
    await releaseHeldReaderWorkerContinuations(page);

    await expect
      .poll(() => replacementRendered(page, oldOpen), { timeout: LOAD_TIMEOUT_MS })
      .toBe(true);
    await expect
      .poll(() => readerSessionReleased(page, oldOpen), { timeout: LOAD_TIMEOUT_MS })
      .toBe(true);
    await expect
      .poll(() => readerWorkerOwnershipSettled(page, oldOpen), { timeout: 5_000 })
      .toBe(true);
    const operations = await readReaderWorkerOperations(page);
    const creations = await readReaderWorkerCreations(page);
    const terminations = await readReaderWorkerTerminations(page);
    assertReleaseProtocol(operations, oldOpen, held.requestId, creations, terminations);
  });
});

async function loadDemo(page: Page): Promise<void> {
  await expect(page.getByTestId('reader-empty')).toBeVisible({ timeout: LOAD_TIMEOUT_MS });
  await page.getByTestId('load-demo-button').click();
  await expect(page.getByTestId('reader-shell')).toHaveAttribute('data-loaded', 'true', {
    timeout: LOAD_TIMEOUT_MS,
  });
  await expect.poll(() => hasNonBlankCanvas(page), { timeout: LOAD_TIMEOUT_MS }).toBe(true);
}

async function reloadDemo(page: Page): Promise<void> {
  await openReaderContextMenu(page);
  await page.getByRole('menuitem', { name: 'Load Demo' }).click();
}

async function currentReaderOpen(page: Page): Promise<ReaderWorkerOperationObservation> {
  const open = (await readReaderWorkerOperations(page))
    .filter((entry) => entry.kind === 'open' && entry.ok === true)
    .at(-1);
  if (!open) throw new Error('Reader worker did not open');
  return open;
}

async function moveToPartialExtentBoundary(page: Page): Promise<void> {
  await expect.poll(() => hasIncompleteRevision(page), { timeout: LOAD_TIMEOUT_MS }).toBe(true);
  const knownSpreadCount = await readerNumberAttribute(page, 'data-total-spreads');
  await page.keyboard.press('End');
  await expect
    .poll(() => currentSpread(page), { timeout: LOAD_TIMEOUT_MS })
    .toBe(knownSpreadCount - 1);
}

async function requestNextSpread(page: Page): Promise<void> {
  await openReaderContextMenu(page);
  const next = page.getByRole('menuitem', { name: /Next Page/ });
  await expect(next).not.toHaveAttribute('data-disabled', '');
  await next.click();
}

async function openReaderContextMenu(page: Page): Promise<void> {
  await page.getByTestId('reader-context-trigger').click({ button: 'right' });
}

async function hasIncompleteRevision(page: Page): Promise<boolean> {
  return (await readReaderWorkerOperations(page)).some(
    (entry) =>
      entry.revision !== null &&
      entry.revision.status !== null &&
      entry.revision.status !== 'complete',
  );
}

async function replacementRendered(
  page: Page,
  oldOpen: ReaderWorkerOperationObservation,
): Promise<boolean> {
  const operations = await readReaderWorkerOperations(page);
  const dispose = findSessionDispose(operations, oldOpen);
  if (!dispose?.completedAt) return false;
  const replacement = findReplacementOpen(operations, oldOpen, dispose);
  if (!replacement?.completedAt) return false;
  const replacementCompletedAt = replacement.completedAt;
  const hasFirstFrame = operations.some(
    (entry) =>
      entry.workerId === replacement.workerId &&
      entry.kind === 'warmFrameWindowAtRevision' &&
      entry.startedAt >= replacementCompletedAt &&
      entry.ok === true,
  );
  return hasFirstFrame && (await hasNonBlankCanvas(page));
}

async function readerSessionReleased(
  page: Page,
  oldOpen: ReaderWorkerOperationObservation,
): Promise<boolean> {
  const dispose = findSessionDispose(await readReaderWorkerOperations(page), oldOpen);
  return dispose?.ok === true && dispose.releasedDocument === true && dispose.completedAt !== null;
}

async function readerWorkerOwnershipSettled(
  page: Page,
  oldOpen: ReaderWorkerOperationObservation,
): Promise<boolean> {
  const operations = await readReaderWorkerOperations(page);
  const dispose = findSessionDispose(operations, oldOpen);
  if (!dispose?.completedAt) return false;
  const replacement = findReplacementOpen(operations, oldOpen, dispose);
  if (!replacement?.completedAt) return false;
  const creations = await readReaderWorkerCreations(page);
  const terminations = await readReaderWorkerTerminations(page);
  const liveWorkers = liveWorkerIds(creations, terminations);
  return liveWorkers.length === 1 && liveWorkers[0] === replacement.workerId;
}
