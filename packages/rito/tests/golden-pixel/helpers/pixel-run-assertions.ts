import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { expect, type TestInfo } from '@playwright/test';
import {
  createPixelGoldenSummary,
  createPixelSpreadCase,
  type PixelGoldenRun,
  type PixelGoldenSpreadCase,
  type PixelGoldenSummary,
} from './pixel-cases';
import {
  readPixelGoldenSpread,
  readPixelGoldenSummary,
  resetPixelGoldenRun,
  writePixelGoldenSpread,
  writePixelGoldenSummary,
} from './pixel-golden-file';
import { pixelReviewCasePaths, writePixelReviewCase, type PixelReviewRecord } from './pixel-review';
import { pixelSpreadIndexesForSelection } from './pixel-spread-selection';
import { comparePng } from './png-diff';

export interface PixelRunRenderResult {
  readonly totalSpreads: number;
  readonly spreads: readonly PixelRenderedSpread[];
}

interface PixelRenderedSpread {
  readonly spreadIndex: number;
  readonly png: Buffer;
}

export async function updatePixelRunGoldens(
  run: PixelGoldenRun,
  result: PixelRunRenderResult,
): Promise<void> {
  if (run.spreadSelection.mode !== 'explicit') {
    await resetPixelGoldenRun(run);
  }
  await writePixelGoldenSummary(run, createPixelGoldenSummary(run, result.totalSpreads));
  for (const spread of result.spreads) {
    await writePixelGoldenSpread(run, spread.spreadIndex, spread.png);
  }
}

export async function reviewPixelRun(
  run: PixelGoldenRun,
  result: PixelRunRenderResult,
): Promise<readonly PixelReviewRecord[]> {
  const records: PixelReviewRecord[] = [];
  for (const spread of result.spreads) {
    const testCase = createPixelSpreadCase(run, spread.spreadIndex, result.totalSpreads);
    const expected = await readPixelGoldenSpread(run, spread.spreadIndex);
    records.push(await reviewPixelSpreadCase(testCase, expected, spread.png));
  }
  return records;
}

export async function comparePixelRun(
  run: PixelGoldenRun,
  result: PixelRunRenderResult,
  testInfo: TestInfo,
): Promise<void> {
  const failures = await collectPixelRunFailures(run, result, testInfo);
  expect(failures).toEqual([]);
}

async function collectPixelRunFailures(
  run: PixelGoldenRun,
  result: PixelRunRenderResult,
  testInfo: TestInfo,
): Promise<readonly string[]> {
  const failures = await comparePixelSummary(run, result.totalSpreads);
  const spreadsByIndex = new Map(result.spreads.map((spread) => [spread.spreadIndex, spread]));

  for (const spreadIndex of pixelSpreadIndexesForSelection(
    run.spreadSelection,
    result.totalSpreads,
  )) {
    const spread = spreadsByIndex.get(spreadIndex);
    if (!spread) {
      failures.push(`${run.id} did not render spread ${String(spreadIndex)}`);
      continue;
    }
    const testCase = createPixelSpreadCase(run, spreadIndex, result.totalSpreads);
    const expected = await readPixelGoldenSpread(run, spreadIndex);
    failures.push(...(await comparePixelSpreadCase(testCase, expected, spread.png, testInfo)));
  }

  return failures;
}

async function comparePixelSummary(run: PixelGoldenRun, totalSpreads: number): Promise<string[]> {
  const expectedSummary = await readPixelGoldenSummary(run);
  const actualSummary = createPixelGoldenSummary(run, totalSpreads);
  if (!expectedSummary) {
    return [`Missing pixel summary for ${run.id}. Run pnpm test:golden:pixel:update`];
  }
  return [...compareSummaries(run.id, expectedSummary, actualSummary)];
}

async function comparePixelSpreadCase(
  testCase: PixelGoldenSpreadCase,
  expected: Buffer | undefined,
  actual: Buffer,
  testInfo: TestInfo,
): Promise<readonly string[]> {
  if (!expected) {
    await writeOutput(testInfo.outputPath(`${testCase.id}-actual.png`), actual);
    return [`Missing pixel golden for ${testCase.id}. Run pnpm test:golden:pixel:update`];
  }

  const actualPath = testInfo.outputPath(`${testCase.id}-actual.png`);
  const diffPath = testInfo.outputPath(`${testCase.id}-diff.png`);
  try {
    const result = await comparePng(expected, actual, testCase, diffPath);
    if (result.diffRatio > testCase.maxDiffPixelRatio) {
      await writeOutput(actualPath, actual);
      return [formatDiffMessage(testCase, result.diffPixels, result.diffRatio)];
    }
    return [];
  } catch (error) {
    await writeOutput(actualPath, actual);
    return [`${testCase.id}: ${error instanceof Error ? error.message : String(error)}`];
  }
}

async function reviewPixelSpreadCase(
  testCase: PixelGoldenSpreadCase,
  expected: Buffer | undefined,
  actual: Buffer,
): Promise<PixelReviewRecord> {
  if (!expected) return await writePixelReviewCase({ testCase, actual });

  const paths = pixelReviewCasePaths(testCase);
  try {
    const diff = await comparePng(expected, actual, testCase, paths.diffPath, {
      writeDiffWhenEqual: true,
    });
    return await writePixelReviewCase({ testCase, actual, expected, diff });
  } catch (error) {
    return await writePixelReviewCase({
      testCase,
      actual,
      expected,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

async function writeOutput(path: string, content: Buffer): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content);
}

function compareSummaries(
  runId: string,
  expected: PixelGoldenSummary,
  actual: PixelGoldenSummary,
): readonly string[] {
  const failures: string[] = [];
  for (const key of Object.keys(actual) as (keyof PixelGoldenSummary)[]) {
    const actualValue = actual[key];
    if (expected[key] !== actualValue) {
      failures.push(
        `${runId} summary ${key} changed: expected ${String(expected[key])}, actual ${String(
          actualValue,
        )}`,
      );
    }
  }
  return failures;
}

function formatDiffMessage(
  testCase: PixelGoldenSpreadCase,
  diffPixels: number,
  diffRatio: number,
): string {
  return `${testCase.id} pixel diff ${String(diffPixels)} (${diffRatio.toFixed(6)}) exceeds ${String(
    testCase.maxDiffPixelRatio,
  )}`;
}
