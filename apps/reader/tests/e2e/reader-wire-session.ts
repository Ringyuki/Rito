import { devices, expect, type Browser, type Page } from '@playwright/test';
import {
  currentSpread,
  hasNonBlankCanvas,
  readerAttribute,
  readerNumberAttribute,
  resetToFirstSpread,
} from './reader-page-harness';
import {
  measurePageTurn,
  rounded,
  summarizeLongTasks,
  summarizeNumbers,
  type FrameGapSummary,
  type LongTaskSummary,
  type TurnMeasurement,
} from './reader-wire-metrics';
import {
  installReaderWireProbe,
  readReaderLongTasks,
  readReaderWireObservations,
  type ReaderRevisionWireObservation,
  type ReaderRuntimeWire,
} from './reader-wire-probe';

const READER_LOAD_TIMEOUT_MS = 90_000;
const TURNS_PER_DIRECTION = 3;

export interface TurnPhaseReport {
  readonly name: 'initial-full' | 'settings-reflow-full';
  readonly turns: TurnMeasurement[];
  readonly readiness: FrameGapSummary;
  readonly endingSpread: number;
}

export interface RevisionPhaseReport {
  readonly previewReadyMs: number;
  readonly fullReadyMs: number;
  readonly preview: ReaderRevisionWireObservation;
  readonly full: ReaderRevisionWireObservation;
  readonly committedSpreadCount: number;
}

export interface WireSessionReport {
  readonly sessionIndex: number;
  readonly wire: ReaderRuntimeWire;
  readonly observedWire: ReaderRuntimeWire | null;
  readonly bookTitle: string;
  readonly canvasNonBlank: boolean;
  readonly initial: RevisionPhaseReport & { readonly canvasReadyMs: number };
  readonly initialTurns: TurnPhaseReport;
  readonly reflow: RevisionPhaseReport;
  readonly reflowTurns: TurnPhaseReport;
  readonly revisions: ReaderRevisionWireObservation[];
  readonly longTasks: LongTaskSummary;
  readonly consoleErrors: string[];
  readonly pageErrors: string[];
}

interface SessionErrors {
  readonly console: string[];
  readonly page: string[];
}

export async function runWireSession(
  browser: Browser,
  baseURL: string,
  wire: ReaderRuntimeWire,
  sessionIndex: number,
  epubPath?: string,
): Promise<WireSessionReport> {
  const context = await browser.newContext({
    ...devices['Desktop Chrome'],
    baseURL,
    viewport: { width: 1280, height: 720 },
  });
  await installReaderWireProbe(context, wire, true);
  const page = await context.newPage();
  const errors = capturePageErrors(page);
  try {
    return await collectSessionReport(page, wire, sessionIndex, errors, epubPath);
  } finally {
    await context.close();
  }
}

function capturePageErrors(page: Page): SessionErrors {
  const errors: SessionErrors = { console: [], page: [] };
  page.on('console', (message) => {
    if (message.type() === 'error') errors.console.push(message.text());
  });
  page.on('pageerror', (error) => errors.page.push(error.message));
  return errors;
}

async function collectSessionReport(
  page: Page,
  wire: ReaderRuntimeWire,
  sessionIndex: number,
  errors: SessionErrors,
  epubPath?: string,
): Promise<WireSessionReport> {
  await page.goto('/');
  await expect(page.getByTestId('reader-empty')).toBeVisible();
  const initial = await measureInitialRevision(page, wire, epubPath);
  const initialTurns = await measureTurnPhase(page, 'initial-full');
  const reflow = await measureSettingsReflow(page, wire);
  const reflowTurns = await measureTurnPhase(page, 'settings-reflow-full');
  return {
    sessionIndex,
    wire,
    observedWire: await readObservedWire(page),
    bookTitle: await readerAttribute(page, 'data-book-title'),
    canvasNonBlank: await hasNonBlankCanvas(page),
    initial,
    initialTurns,
    reflow,
    reflowTurns,
    revisions: await readReaderWireObservations(page),
    longTasks: summarizeLongTasks(await readReaderLongTasks(page)),
    consoleErrors: errors.console,
    pageErrors: errors.page,
  };
}

async function measureInitialRevision(
  page: Page,
  wire: ReaderRuntimeWire,
  epubPath?: string,
): Promise<WireSessionReport['initial']> {
  const observationStart = (await readReaderWireObservations(page)).length;
  const startedAt = performance.now();
  await loadBenchmarkBook(page, epubPath);
  await waitForLoadedReader(page);
  const previewReadyMs = performance.now() - startedAt;
  const preview = await checkedRevision(page, observationStart, 'preview', wire);
  await waitForCommittedSpreadCount(page, preview.spreadCount);
  await expect.poll(() => hasNonBlankCanvas(page)).toBe(true);
  const canvasReadyMs = performance.now() - startedAt;
  const full = await checkedRevision(page, observationStart, 'full', wire);
  await waitForCommittedSpreadCount(page, full.spreadCount);
  return {
    previewReadyMs: rounded(previewReadyMs),
    fullReadyMs: rounded(performance.now() - startedAt),
    canvasReadyMs: rounded(canvasReadyMs),
    preview,
    full,
    committedSpreadCount: full.spreadCount ?? 0,
  };
}

async function loadBenchmarkBook(page: Page, epubPath?: string): Promise<void> {
  if (epubPath === undefined) {
    await page.getByTestId('load-demo-button').click();
    return;
  }
  await page.locator('input[type="file"][accept=".epub"]').first().setInputFiles(epubPath);
}

function waitForLoadedReader(page: Page): Promise<void> {
  return expect(page.getByTestId('reader-shell'))
    .toHaveAttribute('data-loaded', 'true', { timeout: READER_LOAD_TIMEOUT_MS })
    .then(() => undefined);
}

async function measureSettingsReflow(
  page: Page,
  wire: ReaderRuntimeWire,
): Promise<RevisionPhaseReport> {
  await resetToFirstSpread(page);
  const observationStart = (await readReaderWireObservations(page)).length;
  await openReaderSettings(page);
  const startedAt = performance.now();
  await page.getByRole('button', { name: 'Single Page' }).click();
  await expect(page.getByTestId('reader-shell')).toHaveAttribute('data-spread-mode', 'single');
  const preview = await checkedRevision(page, observationStart, 'preview', wire);
  const previewReadyMs = performance.now() - startedAt;
  const full = await checkedRevision(page, observationStart, 'full', wire);
  await waitForCommittedSpreadCount(page, full.spreadCount);
  await closeReaderSettings(page);
  return {
    previewReadyMs: rounded(previewReadyMs),
    fullReadyMs: rounded(performance.now() - startedAt),
    preview,
    full,
    committedSpreadCount: full.spreadCount ?? 0,
  };
}

async function openReaderSettings(page: Page): Promise<void> {
  await page.getByTestId('reader-context-trigger').click({ button: 'right' });
  await page.getByRole('menuitem', { name: /Reader Settings/ }).click();
  await expect(page.getByRole('heading', { name: 'Reader Settings' })).toBeVisible();
}

async function closeReaderSettings(page: Page): Promise<void> {
  await page.keyboard.press('Escape');
  await expect(page.getByRole('heading', { name: 'Reader Settings' })).toBeHidden();
}

async function checkedRevision(
  page: Page,
  startIndex: number,
  mode: 'preview' | 'full',
  wire: ReaderRuntimeWire,
): Promise<ReaderRevisionWireObservation> {
  const observation = await waitForRevisionResponse(page, startIndex, mode);
  expect(observation.wire).toBe(wire);
  expect(observation.ok).toBe(true);
  expect(observation.viewKind).toBe(mode);
  expect(observation.spreadCount).toBeGreaterThan(0);
  expect(observation.error).toBeNull();
  return observation;
}

async function waitForRevisionResponse(
  page: Page,
  startIndex: number,
  mode: 'preview' | 'full',
): Promise<ReaderRevisionWireObservation> {
  await expect
    .poll(() => hasCompletedRevision(page, startIndex, mode), { timeout: READER_LOAD_TIMEOUT_MS })
    .toBe(true);
  const observation = (await readReaderWireObservations(page))
    .slice(startIndex)
    .find((entry) => entry.mode === mode && entry.completedAt !== null);
  if (!observation) throw new Error(`missing completed ${mode} revision observation`);
  return observation;
}

async function hasCompletedRevision(
  page: Page,
  startIndex: number,
  mode: 'preview' | 'full',
): Promise<boolean> {
  return (await readReaderWireObservations(page))
    .slice(startIndex)
    .some((entry) => entry.mode === mode && entry.completedAt !== null);
}

function waitForCommittedSpreadCount(page: Page, spreadCount: number | null): Promise<void> {
  return expect
    .poll(() => readerNumberAttribute(page, 'data-total-spreads'))
    .toBe(spreadCount)
    .then(() => undefined);
}

async function measureTurnPhase(
  page: Page,
  name: TurnPhaseReport['name'],
): Promise<TurnPhaseReport> {
  await resetToFirstSpread(page);
  const turns: TurnMeasurement[] = [];
  for (let index = 0; index < TURNS_PER_DIRECTION; index += 1) {
    turns.push(await measurePageTurn(page, 'forward'));
  }
  for (let index = 0; index < TURNS_PER_DIRECTION; index += 1) {
    turns.push(await measurePageTurn(page, 'backward'));
  }
  return {
    name,
    turns,
    readiness: summarizeNumbers(turns.map((turn) => turn.readinessMs)),
    endingSpread: await currentSpread(page),
  };
}

async function readObservedWire(page: Page): Promise<ReaderRuntimeWire | null> {
  return page.evaluate(() => {
    const runtime = globalThis as typeof globalThis & {
      __RITO_CORE_WASM_READER_WIRE__?: ReaderRuntimeWire;
    };
    return runtime.__RITO_CORE_WASM_READER_WIRE__ ?? null;
  });
}
