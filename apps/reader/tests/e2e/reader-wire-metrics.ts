import { expect, type Page } from '@playwright/test';
import { currentSpread } from './reader-page-harness';
import { readReaderLongTasks, type ReaderLongTaskObservation } from './reader-wire-probe';

const TURN_SAMPLE_MS = 750;

export interface FrameSampleState {
  readonly startedAt: number;
  completedAt: number | null;
  readonly gaps: number[];
}

export interface FrameGapSummary {
  readonly sampleCount: number;
  readonly medianMs: number;
  readonly p95Ms: number;
  readonly maxMs: number;
  readonly over32Ms: number;
  readonly over50Ms: number;
}

export interface ScalarSummary {
  readonly sampleCount: number;
  readonly min: number;
  readonly median: number;
  readonly p95: number;
  readonly max: number;
}

export interface LongTaskSummary {
  readonly count: number;
  readonly totalMs: number;
  readonly maxMs: number;
}

export interface TurnMeasurement {
  readonly direction: 'forward' | 'backward';
  readonly beforeSpread: number;
  readonly afterSpread: number;
  readonly readinessMs: number;
  readonly frameGaps: FrameGapSummary;
  readonly longTasks: LongTaskSummary;
}

interface BrowserFrameSampleGlobal {
  __RITO_WIRE_AB_FRAME_SAMPLE__?: FrameSampleState;
}

export async function measurePageTurn(
  page: Page,
  direction: 'forward' | 'backward',
): Promise<TurnMeasurement> {
  const beforeSpread = await currentSpread(page);
  const afterSpread = beforeSpread + (direction === 'forward' ? 1 : -1);
  const longTaskStart = (await readReaderLongTasks(page)).length;
  await startFrameSample(page);
  const readinessStartedAt = performance.now();
  await page.keyboard.press(direction === 'forward' ? 'ArrowRight' : 'ArrowLeft');
  await expect.poll(() => currentSpread(page)).toBe(afterSpread);
  const readinessMs = performance.now() - readinessStartedAt;
  const sample = await finishFrameSample(page);
  const tasks = await longTasksInSample(page, longTaskStart, sample);
  return {
    direction,
    beforeSpread,
    afterSpread,
    readinessMs: rounded(readinessMs),
    frameGaps: summarizeNumbers(sample.gaps),
    longTasks: summarizeLongTasks(tasks),
  };
}

async function longTasksInSample(
  page: Page,
  startIndex: number,
  sample: FrameSampleState,
): Promise<ReaderLongTaskObservation[]> {
  const completedAt = sample.completedAt ?? sample.startedAt;
  return (await readReaderLongTasks(page))
    .slice(startIndex)
    .filter((task) => task.startTime >= sample.startedAt && task.startTime <= completedAt);
}

async function startFrameSample(page: Page): Promise<void> {
  await page.evaluate((durationMs) => {
    const runtime = globalThis as typeof globalThis & BrowserFrameSampleGlobal;
    const startedAt = performance.now();
    const sample: FrameSampleState = { startedAt, completedAt: null, gaps: [] };
    runtime.__RITO_WIRE_AB_FRAME_SAMPLE__ = sample;
    let previous = startedAt;
    const onFrame = (now: number): void => {
      sample.gaps.push(now - previous);
      previous = now;
      if (now - startedAt >= durationMs) {
        sample.completedAt = now;
      } else {
        requestAnimationFrame(onFrame);
      }
    };
    requestAnimationFrame(onFrame);
  }, TURN_SAMPLE_MS);
}

async function finishFrameSample(page: Page): Promise<FrameSampleState> {
  await expect
    .poll(() => frameSampleComplete(page), { timeout: TURN_SAMPLE_MS + 5_000 })
    .toBe(true);
  return page.evaluate(() => {
    const runtime = globalThis as typeof globalThis & BrowserFrameSampleGlobal;
    const sample = runtime.__RITO_WIRE_AB_FRAME_SAMPLE__;
    if (!sample) throw new Error('missing frame sample');
    return { ...sample, gaps: [...sample.gaps] };
  });
}

function frameSampleComplete(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const runtime = globalThis as typeof globalThis & BrowserFrameSampleGlobal;
    const completedAt = runtime.__RITO_WIRE_AB_FRAME_SAMPLE__?.completedAt;
    return typeof completedAt === 'number';
  });
}

export function summarizeNumbers(values: readonly number[]): FrameGapSummary {
  const sorted = [...values].sort((left, right) => left - right);
  return {
    sampleCount: sorted.length,
    medianMs: rounded(percentile(sorted, 0.5)),
    p95Ms: rounded(percentile(sorted, 0.95)),
    maxMs: rounded(sorted.at(-1) ?? 0),
    over32Ms: sorted.filter((value) => value > 32).length,
    over50Ms: sorted.filter((value) => value > 50).length,
  };
}

export function summarizeScalars(values: readonly number[]): ScalarSummary {
  const sorted = [...values].sort((left, right) => left - right);
  return {
    sampleCount: sorted.length,
    min: rounded(sorted[0] ?? 0),
    median: rounded(percentile(sorted, 0.5)),
    p95: rounded(percentile(sorted, 0.95)),
    max: rounded(sorted.at(-1) ?? 0),
  };
}

export function summarizeLongTasks(tasks: readonly ReaderLongTaskObservation[]): LongTaskSummary {
  return {
    count: tasks.length,
    totalMs: rounded(tasks.reduce((total, task) => total + task.duration, 0)),
    maxMs: rounded(Math.max(0, ...tasks.map((task) => task.duration))),
  };
}

function percentile(sorted: readonly number[], ratio: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.ceil((sorted.length - 1) * ratio);
  return sorted[index] ?? 0;
}

export function rounded(value: number): number {
  return Math.round(value * 1000) / 1000;
}
