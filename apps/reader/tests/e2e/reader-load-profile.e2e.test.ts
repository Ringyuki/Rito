import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { existsSync, statSync } from 'node:fs';
import { basename, isAbsolute, resolve } from 'node:path';
import { hasNonBlankCanvas, readerNumberAttribute } from './reader-page-harness';
import {
  installReaderWorkerProbe,
  readReaderLongTasks,
  readReaderWorkerOperations,
  type ReaderWorkerOperationObservation,
} from './reader-worker-probe';

const PROFILE_EPUB = configuredEpubPath();
const READER_LOAD_TIMEOUT_MS = 90_000;

test.use({ trace: 'off', video: 'off' });

test.describe('production bounded reader load profile', () => {
  test.skip(PROFILE_EPUB === undefined, 'Set RITO_READER_PROFILE_EPUB to an absolute EPUB path');

  test('records open, bounded layout, and host commit phases', async ({ page }, testInfo) => {
    test.setTimeout(120_000);
    const epubPath = requireProfileEpub();
    const errors = collectBrowserErrors(page);
    await installReaderWorkerProbe(page);
    await page.goto('/');
    await expect(page.getByTestId('reader-empty')).toBeVisible();

    const startedAt = await pageNow(page);
    await page.locator('input[type="file"][accept=".epub"]').first().setInputFiles(epubPath);
    await expect(page.getByTestId('reader-shell')).toHaveAttribute('data-loaded', 'true', {
      timeout: READER_LOAD_TIMEOUT_MS,
    });
    const loadedAt = await pageNow(page);
    await expect.poll(() => readerNumberAttribute(page, 'data-total-spreads')).toBeGreaterThan(0);
    await expect
      .poll(() => hasNonBlankCanvas(page), { timeout: READER_LOAD_TIMEOUT_MS })
      .toBe(true);
    const canvasAt = await pageNow(page);
    await page.waitForTimeout(250);

    const operations = await readReaderWorkerOperations(page);
    const report = buildProfileReport({
      epubPath,
      startedAt,
      loadedAt,
      canvasAt,
      operations,
      longTasks: await readReaderLongTasks(page),
    });
    const json = JSON.stringify(report, null, 2);
    console.log(
      `Rito bounded reader load profile\n${JSON.stringify(consoleSummary(report), null, 2)}`,
    );
    await attachReport(testInfo, json);

    expect(errors, errors.join('\n')).toEqual([]);
    expect(operations.some((entry) => entry.ok === false)).toBe(false);
    expect(operations.some((entry) => entry.kind === 'open' && entry.ok === true)).toBe(true);
    expect(
      operations.some((entry) => entry.kind === 'createBoundedRevision' && entry.ok === true),
    ).toBe(true);
    expect(operations.some((entry) => entry.kind === 'createViewRevision')).toBe(false);
  });
});

interface ProfileInput {
  readonly epubPath: string;
  readonly startedAt: number;
  readonly loadedAt: number;
  readonly canvasAt: number;
  readonly operations: readonly ReaderWorkerOperationObservation[];
  readonly longTasks: readonly { readonly duration: number }[];
}

function buildProfileReport(input: ProfileInput) {
  const firstOpen = input.operations.find((entry) => entry.kind === 'open');
  const initialWorkerId = firstOpen?.workerId;
  const initialOperations = input.operations.filter((entry) => entry.workerId === initialWorkerId);
  return {
    generatedAt: new Date().toISOString(),
    fixture: input.epubPath,
    fixtureBytes: statSync(input.epubPath).size,
    milestones: profileMilestones(input, initialOperations),
    operationsByKind: summarizeOperations(input.operations),
    initialWorkerOperationsByKind: summarizeOperations(initialOperations),
    followUpOperationsByKind: summarizeOperations(
      input.operations.filter((entry) => entry.workerId !== initialWorkerId),
    ),
    operations: input.operations.map(roundOperation),
    longTasks: {
      count: input.longTasks.length,
      totalMs: rounded(input.longTasks.reduce((total, task) => total + task.duration, 0)),
      maxMs: rounded(Math.max(0, ...input.longTasks.map((task) => task.duration))),
    },
  };
}

function profileMilestones(
  input: ProfileInput,
  operations: readonly ReaderWorkerOperationObservation[],
) {
  const open = firstOperation(operations, 'open');
  const bounded = firstOperation(operations, 'createBoundedRevision');
  const presentation = firstOperation(operations, 'getRevisionPresentationAtRevision');
  const frame = firstOperation(operations, 'warmFrameWindowAtRevision');
  const aggregates = [
    firstOperation(operations, 'getFootnotesAtRevision'),
    firstOperation(operations, 'getChapterTextIndicesAtRevision'),
  ].filter((entry): entry is ReaderWorkerOperationObservation => entry !== undefined);
  const prerequisiteEnd = Math.max(
    input.startedAt,
    frame?.completedAt ?? input.startedAt,
    ...aggregates.map((entry) => entry.completedAt ?? input.startedAt),
  );
  return {
    inputToOpenMs: rounded((open?.startedAt ?? input.startedAt) - input.startedAt),
    openRoundTripMs: rounded(open?.durationMs ?? 0),
    boundedToPresentationMs: rounded(
      (presentation?.completedAt ?? bounded?.startedAt ?? input.startedAt) -
        (bounded?.startedAt ?? input.startedAt),
    ),
    frameWarmRoundTripMs: rounded(frame?.durationMs ?? 0),
    aggregateReadMs: rounded(operationInterval(aggregates)),
    hostCommitGapMs: rounded(input.loadedAt - prerequisiteEnd),
    loadedToCanvasMs: rounded(input.canvasAt - input.loadedAt),
    loadedMs: rounded(input.loadedAt - input.startedAt),
    canvasReadyMs: rounded(input.canvasAt - input.startedAt),
  };
}

function firstOperation(
  operations: readonly ReaderWorkerOperationObservation[],
  kind: string,
): ReaderWorkerOperationObservation | undefined {
  return operations.find((entry) => entry.kind === kind);
}

function operationInterval(operations: readonly ReaderWorkerOperationObservation[]): number {
  if (operations.length === 0) return 0;
  return (
    Math.max(...operations.map((entry) => entry.completedAt ?? entry.startedAt)) -
    Math.min(...operations.map((entry) => entry.startedAt))
  );
}

function consoleSummary(report: ReturnType<typeof buildProfileReport>) {
  return {
    fixture: report.fixture,
    fixtureBytes: report.fixtureBytes,
    milestones: report.milestones,
    initialWorkerOperationsByKind: report.initialWorkerOperationsByKind,
    followUpOperationsByKind: report.followUpOperationsByKind,
    longTasks: report.longTasks,
  };
}

function summarizeOperations(operations: readonly ReaderWorkerOperationObservation[]) {
  const kinds = [...new Set(operations.map((entry) => entry.kind))];
  return kinds.map((kind) => {
    const matching = operations.filter((entry) => entry.kind === kind);
    const durations = matching.flatMap((entry) =>
      entry.durationMs === null ? [] : [entry.durationMs],
    );
    return {
      kind,
      count: matching.length,
      completed: durations.length,
      totalMs: rounded(durations.reduce((total, duration) => total + duration, 0)),
      maxMs: rounded(Math.max(0, ...durations)),
    };
  });
}

function roundOperation(operation: ReaderWorkerOperationObservation) {
  return {
    ...operation,
    startedAt: rounded(operation.startedAt),
    completedAt: operation.completedAt === null ? null : rounded(operation.completedAt),
    durationMs: operation.durationMs === null ? null : rounded(operation.durationMs),
  };
}

function configuredEpubPath(): string | undefined {
  const configured = process.env['RITO_READER_PROFILE_EPUB'];
  if (configured === undefined) return undefined;
  if (!isAbsolute(configured)) throw new Error('RITO_READER_PROFILE_EPUB must be absolute');
  const path = resolve(configured);
  if (!existsSync(path) || !statSync(path).isFile()) {
    throw new Error(`RITO_READER_PROFILE_EPUB must identify a file: ${path}`);
  }
  return path;
}

function requireProfileEpub(): string {
  if (PROFILE_EPUB === undefined) throw new Error('missing RITO_READER_PROFILE_EPUB');
  return PROFILE_EPUB;
}

function collectBrowserErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`);
  });
  page.on('pageerror', (error) => errors.push(`page: ${error.stack ?? error.message}`));
  return errors;
}

function pageNow(page: Page): Promise<number> {
  return page.evaluate(() => performance.now());
}

function attachReport(testInfo: TestInfo, json: string): Promise<void> {
  return testInfo.attach(`reader-load-profile-${basename(requireProfileEpub())}`, {
    body: Buffer.from(json),
    contentType: 'application/json',
  });
}

function rounded(value: number): number {
  return Math.round(value * 1000) / 1000;
}
